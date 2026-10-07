/**
 * R2 acceptance journey for the Accio sourcing bridge, through the real UI, the real
 * MCP endpoint and the real approval boundary (no mocked state):
 *
 *   buyer uploads a DXF and gets a binding quote
 *   -> buyer asks DiscoverMake's manufacturing partners for offers (250 units)
 *   -> ops registers an Accio Work workspace (one-time MCP token) at the sourcing desk API
 *   -> "Accio Work" leases the job over MCP, registers a supplier, submits a
 *      supplier-confirmed offer and completes the job
 *   -> buyer sees the partner route on the Manufacturing Route (no supplier identity)
 *      and asks to choose it
 *   -> ops approves the selection in the Sourcing desk UI
 *   -> buyer sees the route confirmed (nothing ordered or charged)
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_ADMIN_TOKEN } from '../../playwright.config';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';

const ADMIN = { authorization: `Bearer ${E2E_ADMIN_TOKEN}` };

async function confirm(page: Page, testId: string) {
    await page.getByTestId(testId).click();
    await page.getByTestId(`${testId}-confirm`).click();
}

/** Minimal MCP client: stateless Streamable HTTP, JSON responses. */
function mcp(request: APIRequestContext, token: string) {
    let id = 0;
    const send = async (method: string, params?: unknown) => {
        const res = await request.post('/api/mcp/sourcing', {
            headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
            data: { jsonrpc: '2.0', id: ++id, method, ...(params !== undefined ? { params } : {}) },
        });
        expect(res.status(), `${method} -> ${await res.text()}`).toBe(200);
        return res.json();
    };
    return {
        initialize: () => send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'accio-work-e2e', version: '1.0' } }),
        call: async (tool: string, args: Record<string, unknown>) => {
            const body = await send('tools/call', { name: `discovermake.sourcing.${tool}`, arguments: args });
            expect(body.result.isError, `${tool}: ${JSON.stringify(body.result.structuredContent)}`).toBeFalsy();
            return body.result.structuredContent as Record<string, unknown>;
        },
    };
}

test('Accio Work sources a part over MCP and a human approves the route', async ({ page, request }) => {
    // ---- Buyer: upload + binding quote ----
    await page.goto('/');
    await page.getByTestId('upload-input').setInputFiles({ name: 'e2e-sourcing.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
    const partId = page.url().split('/').pop()!;
    await page.getByTestId('material-option-mat_al_6061').click();
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
    await page.getByTestId('checkout-cta').click();
    await page.waitForURL(/\/checkout\/qte_/);
    const quoteId = page.url().match(/qte_[A-Za-z0-9_-]+/)![0];
    const part = await (await request.get(`/api/parts/${partId}`)).json();
    const buildId: string = part.buildId;

    // ---- Buyer: ask partners for offers at volume ----
    const created = await request.post(`/api/builds/${buildId}/sourcing`, { data: { partId, quantity: 250, targetRegions: ['VN', 'CN'] } });
    expect(created.status()).toBe(201);
    const job = await created.json();

    // ---- Ops: register the Accio Work workspace (token shown once) ----
    const client = await (await request.post('/api/admin/sourcing/clients', { headers: ADMIN, data: { name: 'Accio Work · e2e' } })).json();
    expect(client.token).toMatch(/^dmsc_/);

    // ---- Accio Work over MCP ----
    const accio = mcp(request, client.token);
    const init = await accio.initialize();
    expect(init.result.instructions).toMatch(/Approval boundary/);
    const next = await accio.call('next_job', {});
    const leasedJob = next.job as { sourcing_request_id: string; design_version: number; quantity: number };
    expect(leasedJob.sourcing_request_id).toBe(job.id);
    const lease = { sourcing_request_id: job.id, lease_id: next.lease_id as string };
    const supplier = await accio.call('submit_supplier', { ...lease, name: 'Da Nang Precision Sheet Metal', platform: 'alibaba', platform_ref: 'e2e-dnpsm', country: 'VN', verified: true });
    const supplierId = supplier.supplier_id as string;
    const offer = await accio.call('submit_offer', {
        ...lease,
        idempotency_key: 'e2e-dnpsm-rev1',
        supplier_id: supplierId,
        design_version: leasedJob.design_version,
        quantity: leasedJob.quantity,
        unit_price_cents: 640,
        tooling_cents: 0,
        shipping_cents: 18_000,
        moq: 100,
        production_lead_days: 12,
        shipping_lead_days: 9,
        incoterm: 'DDP',
        material: 'Aluminum 6061-T6, 0.090 in',
        processes: ['laser cutting'],
        confidence: 0.9,
        negotiation_status: 'supplier-confirmed',
    });
    const offerId = offer.supplier_offer_id as string;
    expect(offer.trust_level).toBe('SUPPLIER_CONFIRMED');
    // The boundary holds: the full design package is not released without a human.
    const full = await request.post('/api/mcp/sourcing', {
        headers: { authorization: `Bearer ${client.token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
        data: { jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'discovermake.sourcing.get_attachments', arguments: { ...lease, tier: 'FULL', supplier_id: supplierId } } },
    });
    const fullBody = await full.json();
    expect(fullBody.result.isError).toBe(true);
    expect(fullBody.result.structuredContent.error.code).toBe('APPROVAL_REQUIRED');
    await accio.call('complete_job', { ...lease, outcome: 'offers_submitted', summary: 'One verified partner confirmed against the exact design version.' });

    // ---- Buyer: partner route on the Manufacturing Route ----
    await page.goto(`/build/${buildId}/route?quote=${quoteId}`);
    const card = page.getByTestId(`route-offer-${offerId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Vietnam');
    await expect(card).toContainText('Supplier-confirmed');
    await expect(card).not.toContainText('Da Nang Precision');
    await confirm(page, `select-offer-${offerId}`);
    await expect(page.getByTestId('offer-selection-pending')).toBeVisible();

    // ---- Ops: approve in the Sourcing desk ----
    await page.goto('/admin/sourcing');
    await page.getByTestId('sourcing-admin-token-input').fill(E2E_ADMIN_TOKEN);
    await page.getByTestId('sourcing-admin-login-submit').click();
    await page.getByTestId('desk-tab-approvals').click();
    const approvals = await (await request.get('/api/admin/sourcing/approvals?status=PENDING', { headers: ADMIN })).json();
    const selection = approvals.find((a: { supplierOfferId: string | null }) => a.supplierOfferId === offerId);
    expect(selection?.kind).toBe('SELECT_SUPPLIER_OFFER');
    await confirm(page, `approve-${selection.id}`);
    await expect(page.getByTestId(`approval-${selection.id}`)).toHaveCount(0, { timeout: 15_000 });

    // ---- Buyer: route confirmed, nothing ordered ----
    await page.goto(`/build/${buildId}/route?quote=${quoteId}`);
    await expect(page.getByTestId('offer-selection-approved')).toContainText('nothing has been ordered or charged', { timeout: 20_000 });
});
