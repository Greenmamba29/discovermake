/**
 * R3 Prime state for page sweeps, built through the real APIs (buyer calls from the buyer's
 * browser, Accio over the real MCP endpoint, ops with the admin token): a supplier-route order
 * whose freight has shipped inbound to the partner, plus a fresh binding supplier quote.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ADMIN_TOKEN, E2E_DATABASE_URL } from '../../../playwright.config';
import { sampleBracketDxf } from '../../../src/lib/sample-dxf';

const ADMIN = { authorization: `Bearer ${E2E_ADMIN_TOKEN}` };
export const PRIME_CAPABILITY = { shopId: 'shop_philadelphia_precision', thicknessOptionId: 'thk_al6061_090' };

/** Switch the partner's capability for the test spec off (no partner can make it) or back on. */
export async function setPrimeCapability(active: boolean) {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        await sql`update shop_capabilities set active = ${active} where shop_id = ${PRIME_CAPABILITY.shopId} and thickness_option_id = ${PRIME_CAPABILITY.thicknessOptionId}`;
    } finally {
        await sql.end();
    }
}

async function mcpCall(request: APIRequestContext, token: string, tool: string, args: Record<string, unknown>, id: number) {
    const res = await request.post('/api/mcp/sourcing', {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
        data: { jsonrpc: '2.0', id, method: 'tools/call', params: { name: `discovermake.sourcing.${tool}`, arguments: args } },
    });
    const body = await res.json();
    expect(body.result.isError, `${tool}: ${JSON.stringify(body.result.structuredContent)}`).toBeFalsy();
    return body.result.structuredContent as Record<string, unknown>;
}

export type PrimeUrls = { supplierOrderUrl: string; receivingJobUrl: string; primeSourcingJobUrl: string; supplierCheckoutUrl: string };

export async function primeSupplierState(page: Page, request: APIRequestContext): Promise<PrimeUrls> {
    await setPrimeCapability(false);
    try {
        await page.goto('/');
        await page.getByTestId('upload-input').setInputFiles({ name: 'sweep-prime.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
        await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
        const partId = page.url().split('/').pop()!;
        const quote = await (await page.request.post('/api/quotes', { data: { partId, materialId: 'mat_al_6061', thicknessOptionId: PRIME_CAPABILITY.thicknessOptionId, finishServiceId: null, services: [], quantity: 250 } })).json();
        const buildId: string = quote.buildId;
        const job = await (await page.request.post(`/api/builds/${buildId}/sourcing`, { data: { partId, quantity: 250, targetRegions: ['VN'] } })).json();

        const client = await (await request.post('/api/admin/sourcing/clients', { headers: ADMIN, data: { name: 'Accio Work · sweep' } })).json();
        let n = 0;
        let next = await mcpCall(request, client.token, 'next_job', {}, ++n);
        for (let i = 0; i < 20 && next.job && (next.job as { sourcing_request_id: string }).sourcing_request_id !== job.id; i++) next = await mcpCall(request, client.token, 'next_job', {}, ++n);
        const lease = { sourcing_request_id: job.id, lease_id: next.lease_id as string };
        const supplier = await mcpCall(request, client.token, 'submit_supplier', { ...lease, name: 'Sweep Anodizing Works', platform: 'alibaba', platform_ref: 'sweep-prime', country: 'VN', verified: true }, ++n);
        const offer = await mcpCall(
            request,
            client.token,
            'submit_offer',
            {
                ...lease,
                idempotency_key: 'sweep-prime-r1',
                supplier_id: supplier.supplier_id,
                design_version: (next.job as { design_version: number }).design_version,
                quantity: 250,
                unit_price_cents: 690,
                shipping_cents: 21_000,
                moq: 100,
                production_lead_days: 12,
                shipping_lead_days: 9,
                incoterm: 'DDP',
                material: 'Aluminum 6061-T6, 0.090 in, black anodized',
                processes: ['laser cutting', 'anodizing'],
                confidence: 0.92,
                negotiation_status: 'supplier-confirmed',
            },
            ++n,
        );
        const offerId = offer.supplier_offer_id as string;
        await mcpCall(request, client.token, 'complete_job', { ...lease, outcome: 'offers_submitted', summary: 'Sweep offer.' }, ++n);

        const selected = await (await page.request.post(`/api/builds/${buildId}/sourcing/offers/${offerId}/select`)).json();
        await request.post(`/api/admin/sourcing/approvals/${selected.selection.approvalId}/decision`, { headers: ADMIN, data: { decision: 'APPROVED' } });
        const binding = await (await page.request.post(`/api/builds/${buildId}/sourcing/offers/${offerId}/quote`)).json();

        const checkout = await (
            await page.request.post('/api/checkout', {
                data: {
                    quoteId: binding.id,
                    shippingMethod: 'STANDARD',
                    buyer: { email: 'sweep-prime@example.com', name: 'Sweep Prime' },
                    shippingAddress: { name: 'Sweep Prime', line1: '1 Market St', city: 'San Francisco', region: 'CA', postalCode: '94105', country: 'US' },
                    acceptTerms: true,
                },
            })
        ).json();
        const paid = await (await page.request.post('/api/checkout/dev-confirm', { data: { providerRef: checkout.payment.providerRef, outcome: 'succeeded' } })).json();

        let pending: { id: string; kind: string; details: { orderId?: string } }[] = [];
        await expect(async () => {
            pending = (await (await request.get('/api/admin/sourcing/approvals?status=PENDING', { headers: ADMIN })).json()).filter((a: { details: { orderId?: string } }) => a.details?.orderId === checkout.orderId);
            expect(pending).toHaveLength(2);
        }).toPass({ timeout: 20_000 });
        for (const kind of ['PLACE_PURCHASE_ORDER', 'PAY_DEPOSIT']) {
            await request.post(`/api/admin/sourcing/approvals/${pending.find((a) => a.kind === kind)!.id}/decision`, { headers: ADMIN, data: { decision: 'APPROVED' } });
        }
        const detail = await (await request.get(`/api/admin/sourcing/jobs/${job.id}`, { headers: ADMIN })).json();
        const legId = detail.legs[0].id as string;
        await request.post(`/api/admin/supplier-legs/${legId}/advance`, { headers: ADMIN, data: { to: 'IN_PRODUCTION_AT_SUPPLIER' } });
        const inbound = await (await request.post(`/api/admin/supplier-legs/${legId}/advance`, { headers: ADMIN, data: { to: 'SHIPPED_INBOUND', inboundCarrier: 'Maersk', inboundTracking: 'MAEU0000001' } })).json();

        // A fresh binding supplier quote (the first one is now ordered) for the checkout screen.
        const fresh = await (await page.request.post(`/api/builds/${buildId}/sourcing/offers/${offerId}/quote`)).json();
        return {
            supplierOrderUrl: new URL(paid.redirectUrl).pathname + new URL(paid.redirectUrl).search,
            receivingJobUrl: `/shop/jobs/${inbound.receivingJobId}`,
            primeSourcingJobUrl: `/admin/sourcing/jobs/${job.id}`,
            supplierCheckoutUrl: `/checkout/${fresh.id}`,
        };
    } finally {
        await setPrimeCapability(true);
    }
}
