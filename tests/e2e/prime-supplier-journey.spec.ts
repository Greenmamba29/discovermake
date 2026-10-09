/**
 * Stage 2 G3 demo (minus Prime membership) through the real UI, the real MCP endpoint and the
 * real approval boundary:
 *
 *   a 250-unit part no partner shop can make (the partner's capability for it is off)
 *   -> Accio Work (over MCP) submits a supplier-confirmed offer
 *   -> buyer chooses the route, ops confirms it in the Sourcing desk
 *   -> buyer sees ONE price and ONE "Arrives <date>" and pays the deposit (dev provider)
 *   -> ops approves the PO and the supplier deposit, records production and inbound freight
 *   -> the partner receives the freight and passes QA at receipt in the Shop Console
 *   -> buyer pays the balance, the partner ships, ops confirms delivery
 *   -> the buyer's tracking shows one sentence per step, all done.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ADMIN_TOKEN, E2E_DATABASE_URL } from '../../playwright.config';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';
import { confirm, shopLogin } from './support/journeys';

const ADMIN = { authorization: `Bearer ${E2E_ADMIN_TOKEN}` };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const CAPABILITY = { shopId: 'shop_philadelphia_precision', thicknessOptionId: 'thk_al6061_090' };

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
        initialize: () => send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'accio-work-e2e-prime', version: '1.0' } }),
        call: async (tool: string, args: Record<string, unknown>) => {
            const body = await send('tools/call', { name: `discovermake.sourcing.${tool}`, arguments: args });
            expect(body.result.isError, `${tool}: ${JSON.stringify(body.result.structuredContent)}`).toBeFalsy();
            return body.result.structuredContent as Record<string, unknown>;
        },
    };
}

async function setCapability(active: boolean) {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        await sql`update shop_capabilities set active = ${active} where shop_id = ${CAPABILITY.shopId} and thickness_option_id = ${CAPABILITY.thicknessOptionId}`;
    } finally {
        await sql.end();
    }
}

async function deskLogin(page: Page) {
    await page.goto('/admin/sourcing');
    await page.getByTestId('sourcing-admin-token-input').fill(E2E_ADMIN_TOKEN);
    await page.getByTestId('sourcing-admin-login-submit').click();
    await expect(page.getByTestId('sourcing-job-list')).toBeVisible();
}

async function approveInDesk(page: Page, approvalId: string) {
    await page.getByTestId('desk-tab-approvals').click();
    await confirm(page, `approve-${approvalId}`);
    await expect(page.getByTestId(`approval-${approvalId}`)).toHaveCount(0, { timeout: 15_000 });
}

test('Prime: a supplier-made part with one price, one date, deposit, PO, QA at receipt and delivery', async ({ page, request, context }) => {
    test.setTimeout(240_000);
    await setCapability(false);
    try {
        // ---- Buyer: a part no partner shop can make at this spec ----
        await page.goto('/');
        await page.getByTestId('upload-input').setInputFiles({ name: 'prime-arm.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
        await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
        const partId = page.url().split('/').pop()!;
        const quoted = await page.request.post('/api/quotes', { data: { partId, materialId: 'mat_al_6061', thicknessOptionId: CAPABILITY.thicknessOptionId, finishServiceId: null, services: [], quantity: 250 } });
        expect(quoted.status(), await quoted.text()).toBe(201);
        const shopQuote = await quoted.json();
        expect(shopQuote.status).toBe('REVIEW'); // no partner shop can run it
        const buildId: string = shopQuote.buildId;

        const created = await page.request.post(`/api/builds/${buildId}/sourcing`, { data: { partId, quantity: 250, targetRegions: ['VN'] } });
        expect(created.status()).toBe(201);
        const job = await created.json();

        // ---- Accio Work over the real MCP endpoint ----
        const client = await (await request.post('/api/admin/sourcing/clients', { headers: ADMIN, data: { name: 'Accio Work · prime e2e' } })).json();
        const accio = mcp(request, client.token);
        await accio.initialize();
        let next = await accio.call('next_job', {});
        for (let i = 0; i < 20 && next.job && (next.job as { sourcing_request_id: string }).sourcing_request_id !== job.id; i++) next = await accio.call('next_job', {});
        const leased = next.job as { sourcing_request_id: string; design_version: number; quantity: number };
        expect(leased.sourcing_request_id).toBe(job.id);
        const lease = { sourcing_request_id: job.id, lease_id: next.lease_id as string };
        const supplier = await accio.call('submit_supplier', { ...lease, name: 'Hai Phong Anodizing Works', platform: 'alibaba', platform_ref: 'e2e-prime-hpaw', country: 'VN', verified: true });
        const offer = await accio.call('submit_offer', {
            ...lease,
            idempotency_key: 'e2e-prime-hpaw-rev1',
            supplier_id: supplier.supplier_id,
            design_version: leased.design_version,
            quantity: 250,
            unit_price_cents: 690,
            tooling_cents: 0,
            shipping_cents: 21_000,
            moq: 100,
            production_lead_days: 12,
            shipping_lead_days: 9,
            incoterm: 'DDP',
            material: 'Aluminum 6061-T6, 0.090 in, black anodized',
            processes: ['laser cutting', 'anodizing'],
            confidence: 0.92,
            negotiation_status: 'supplier-confirmed',
        });
        const offerId = offer.supplier_offer_id as string;
        expect(offer.trust_level).toBe('SUPPLIER_CONFIRMED');
        await accio.call('complete_job', { ...lease, outcome: 'offers_submitted', summary: 'Verified anodizer confirmed against the exact design version.' });

        // ---- Buyer chooses the route; ops confirms it ----
        const routeUrl = `/build/${buildId}/route?quote=${shopQuote.id}`;
        await page.goto(routeUrl);
        const card = page.getByTestId(`route-offer-${offerId}`);
        await expect(card).toBeVisible({ timeout: 20_000 });
        await expect(card).not.toContainText('Hai Phong');
        await confirm(page, `select-offer-${offerId}`);
        await expect(page.getByTestId('offer-selection-pending')).toBeVisible();

        const ops = await context.newPage();
        await deskLogin(ops);
        const selection = (await (await request.get('/api/admin/sourcing/approvals?status=PENDING', { headers: ADMIN })).json()).find((a: { supplierOfferId: string | null }) => a.supplierOfferId === offerId);
        expect(selection.kind).toBe('SELECT_SUPPLIER_OFFER');
        await approveInDesk(ops, selection.id);

        // ---- Buyer: one binding price, one date ----
        await page.goto(routeUrl);
        await page.getByTestId(`supplier-quote-${offerId}`).click({ timeout: 20_000 });
        await page.waitForURL(/\/checkout\/qte_/, { timeout: 20_000 });
        await expect(page.getByTestId('supplier-route-card')).toContainText('Verified partner · Vietnam');
        await expect(page.locator('[data-testid^="shipping-option-"][data-testid$="STANDARD"]').first()).toBeVisible();
        await expect(page.locator('label[data-testid^="shipping-option-"]')).toHaveCount(1);
        const arrives = (await page.getByTestId('shipping-option-date-STANDARD').textContent())!.trim();
        expect(arrives).toMatch(/^Arrives [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
        const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
        const dates = new Set([...body.matchAll(/Arrives ([A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2})/g)].map((m) => m[1]));
        expect([...dates]).toEqual([arrives.replace('Arrives ', '')]);
        expect(body).not.toMatch(/Hai Phong|alibaba/i);
        const total = (await page.getByTestId('checkout-total').textContent())!.trim();
        await expect(page.getByTestId('checkout-deposit')).toBeVisible();

        await page.getByTestId('checkout-email').fill('prime-buyer@example.com');
        await page.getByTestId('checkout-name').fill('Prime Buyer');
        await page.getByTestId('checkout-line1').fill('1 Market St');
        await page.getByTestId('checkout-city').fill('San Francisco');
        await page.getByTestId('checkout-region').selectOption('CA');
        await page.getByTestId('checkout-postal').fill('94105');
        await page.getByTestId('checkout-terms').check();
        await expect(page.getByTestId('pay-cta')).toContainText('deposit');
        await page.getByTestId('pay-cta').click();
        await page.getByTestId('dev-pay-button').click();
        await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 30_000 });
        const orderUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
        const orderId = orderUrl.match(/ord_[A-Za-z0-9_-]+/)![0];
        await expect(page.getByTestId('order-status')).toContainText(/approving the purchase order/i, { timeout: 30_000 });
        await expect(page.getByTestId('supplier-step-PO_PLACED')).toHaveAttribute('data-state', 'current');
        await expect(page.getByTestId('order-status')).toContainText(arrives);
        const orderNumber = (await page.locator('text=/DMO-[A-Z0-9]+/').first().textContent())!.match(/DMO-[A-Z0-9]+/)![0];
        expect(total).toMatch(/^\$/);

        // ---- Ops: approve the PO and the supplier deposit (human approval records) ----
        let pending: { id: string; kind: string; details: { orderId?: string } }[] = [];
        await expect(async () => {
            pending = (await (await request.get('/api/admin/sourcing/approvals?status=PENDING', { headers: ADMIN })).json()).filter((a: { details: { orderId?: string } }) => a.details?.orderId === orderId);
            expect(pending.map((a) => a.kind).sort()).toEqual(['PAY_DEPOSIT', 'PLACE_PURCHASE_ORDER']);
        }).toPass({ timeout: 20_000 });
        await ops.reload();
        await approveInDesk(ops, pending.find((a) => a.kind === 'PLACE_PURCHASE_ORDER')!.id);
        await approveInDesk(ops, pending.find((a) => a.kind === 'PAY_DEPOSIT')!.id);

        // ---- Ops: supplier-side updates on the leg ----
        await ops.goto(`/admin/sourcing/jobs/${job.id}`);
        await confirm(ops, 'leg-advance-IN_PRODUCTION_AT_SUPPLIER');
        await expect(ops.getByTestId('leg-status')).toHaveText('IN_PRODUCTION_AT_SUPPLIER', { timeout: 15_000 });
        await ops.getByTestId('leg-carrier').fill('Maersk');
        await ops.getByTestId('leg-tracking').fill('MAEU7654321');
        await confirm(ops, 'leg-advance-SHIPPED_INBOUND');
        await expect(ops.getByTestId('leg-status')).toHaveText('SHIPPED_INBOUND', { timeout: 15_000 });

        await page.goto(orderUrl);
        await expect(page.getByTestId('order-status')).toContainText(/on its way to our partner in Philadelphia/i, { timeout: 20_000 });

        // ---- Partner: receive the freight, QA at receipt ----
        const shop = await context.newPage();
        await shopLogin(shop);
        await shop.getByTestId('jobs-tab-active').click();
        const row = shop.getByRole('link', { name: new RegExp(orderNumber) });
        await expect(row).toContainText('Receiving');
        await row.click();
        await shop.waitForURL(/\/shop\/jobs\/job_/);
        await expect(shop.getByTestId('receiving-panel')).toContainText('MAEU7654321');
        await expect(shop.getByTestId('receiving-panel')).not.toContainText('Hai Phong');
        await confirm(shop, 'receive-freight');
        await expect(shop.getByTestId('qa-form')).toBeVisible({ timeout: 15_000 });
        const checks = shop.locator('[data-testid^="qa-check-"]');
        for (let i = 0; i < (await checks.count()); i++) {
            const check = checks.nth(i);
            const measure = check.locator('[data-testid^="qa-measure-"]');
            if (await measure.count()) {
                const nominal = (await check.textContent())?.match(/nominal (-?[\d.]+)/)?.[1];
                await measure.fill(nominal ?? '0');
            } else {
                await check.locator('[data-testid^="qa-pass-"]').click();
            }
        }
        await shop.getByTestId('qa-photo-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
        await expect(shop.getByTestId('qa-photo').first()).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
        await shop.getByTestId('qa-inspector').fill('Receiving Inspector');
        await confirm(shop, 'qa-submit');
        await expect(shop.getByTestId('job-status-text')).toContainText('Passed inspection', { timeout: 15_000 });

        // ---- Buyer: pay the balance (dev provider) ----
        await page.goto(orderUrl);
        await expect(page.getByTestId('order-status')).toContainText(/pay the balance/i, { timeout: 20_000 });
        await page.getByTestId('pay-balance').click();
        await page.waitForURL(/\/checkout\/dev-pay\?ref=/);
        await page.getByTestId('dev-pay-button').click();
        await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 30_000 });
        await expect(page.getByTestId('supplier-balance')).toBeVisible();
        await expect(page.getByTestId('pay-balance')).toHaveCount(0, { timeout: 15_000 });

        // ---- Partner ships, ops confirms delivery ----
        await shop.reload();
        await shop.getByTestId('ship-mode-manual').click();
        await shop.getByTestId('ship-carrier').fill('UPS');
        await shop.getByTestId('ship-service').fill('Ground');
        await shop.getByTestId('ship-tracking').fill('1Z999AA10123456799');
        await confirm(shop, 'ship-submit');
        await expect(shop.getByTestId('shipment-card')).toBeVisible({ timeout: 15_000 });
        await shop.close();

        await ops.goto('/admin'); // same tab session as the Sourcing desk sign-in
        await ops.getByTestId(`admin-order-${orderNumber}`).click();
        await confirm(ops, 'admin-mark-delivered');
        await expect(ops.getByText(`${orderNumber} marked delivered.`)).toBeVisible({ timeout: 20_000 });
        await ops.close();

        // ---- Buyer: every step done, one plain sentence each ----
        await expect(async () => {
            await page.goto(orderUrl);
            await expect(page.getByTestId('order-status')).toContainText(/complete|delivered/i, { timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        for (const key of ['PO_PLACED', 'IN_PRODUCTION_AT_SUPPLIER', 'SHIPPED_INBOUND', 'RECEIVED_AT_PARTNER', 'SHIPPED_TO_YOU', 'DELIVERED']) {
            await expect(page.getByTestId(`supplier-step-${key}`)).toHaveAttribute('data-state', 'done');
        }
        await expect(page.getByTestId('supplier-route')).toContainText('Purchase order placed with a verified partner in Vietnam');
        await expect(page.getByTestId('supplier-route')).toContainText('Received and inspected by our partner in Philadelphia');
        expect(await page.locator('main').innerText()).not.toMatch(/Hai Phong|alibaba/i);
    } finally {
        await setCapability(true);
    }
});
