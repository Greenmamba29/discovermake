/**
 * R1 release gate: one real order, end to end, through the real UI, route handlers,
 * Postgres and storage. Nothing on the critical path is mocked; the only test doubles
 * are the explicit env-flagged ones from playwright.config.ts (PAYMENT_PROVIDER=dev,
 * CARRIER=manual, STORAGE_DRIVER=local), which refuse to run when NODE_ENV=production.
 *
 *   generated DXF -> upload on / -> configure material / thickness / finish / qty
 *   -> binding quote -> checkout form -> dev payment -> buyer tracker (Paid/Dispatched)
 *   -> Shop Console login (seeded token) -> accept -> milestones -> passing QA
 *   -> ship with manual tracking -> ops marks delivered (admin API, ADMIN_TOKEN)
 *   -> tracker shows Delivered + passport link -> passport page Verified.
 * Plus API-level checks: balanced ledger + payout, and tampered order tokens rejected.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { AdminOrderDetail } from '../../src/contracts/admin';
import { OrderView } from '../../src/contracts/orders';
import { PassportVerifyResponse } from '../../src/contracts/passport';
import { QuoteView } from '../../src/contracts/quotes';
import { E2E_ADMIN_TOKEN, E2E_SHOP_TOKEN } from '../../playwright.config';
import { COVER_PLATE, coverPlateDxf } from './fixtures/dxf';

const MATERIAL = 'mat_al_6061';
const THICKNESS = 'thk_al6061_090';
const FINISH = 'svc_anodize_black';
const QUANTITY = 5;
const TRACKING = '1Z999AA10198765432';
const ADMIN = { authorization: `Bearer ${E2E_ADMIN_TOKEN}` };

// 1x1 PNG used as the inspection photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Two-step confirmations (no window.confirm in the app). */
async function confirm(page: Page, testId: string) {
    await page.getByTestId(testId).click();
    await page.getByTestId(`${testId}-confirm`).click();
}

/** Flip one character of a token so it is well-formed but wrong. */
function tamper(token: string): string {
    const i = Math.floor(token.length / 2);
    return token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
}

async function adminOrder(request: APIRequestContext, orderId: string): Promise<AdminOrderDetail> {
    const res = await request.get(`/api/admin/orders/${orderId}`, { headers: ADMIN });
    expect(res.status()).toBe(200);
    return AdminOrderDetail.parse(await res.json());
}

test.describe.configure({ mode: 'serial' });

test('R1: a customer runs a real order end to end', async ({ page, context, request }) => {
    test.setTimeout(240_000);

    // ---- 1. Upload a generated DXF on the home page ----
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'What do you want to make?' })).toBeVisible();
    await page.getByTestId('upload-input').setInputFiles({ name: 'e2e-cover-plate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(coverPlateDxf()) });
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 60_000 });

    // Geometry came from the real parser.
    await expect(page.getByTestId('part-dimensions')).toContainText(String(COVER_PLATE.widthMm), { timeout: 30_000 });
    await expect(page.getByTestId('part-dimensions')).toContainText(String(COVER_PLATE.heightMm));

    // ---- 2. Configure material / thickness / finish / quantity -> binding quote ----
    const cta = page.getByTestId('checkout-cta');
    await expect(cta).toContainText(/required selection/i);
    await page.getByTestId(`material-option-${MATERIAL}`).click();
    const thickness = page.getByTestId(`thickness-option-${THICKNESS}`);
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await page.getByTestId(`finish-option-${FINISH}`).click();
    const qty = page.getByTestId('qty-stepper-input');
    await qty.fill(String(QUANTITY));
    await qty.press('Enter');
    await expect(qty).toHaveValue(String(QUANTITY));

    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
    await expect(cta).toContainText('Continue to checkout', { timeout: 30_000 });
    await expect(cta).toBeEnabled();
    await cta.click();
    await page.waitForURL(/\/checkout\/qte_[A-Za-z0-9_-]+/, { timeout: 30_000 });
    const quoteId = page.url().match(/\/checkout\/(qte_[A-Za-z0-9_-]+)/)![1];

    // The quote the buyer is paying for is exactly what was configured.
    const quoteRes = await request.get(`/api/quotes/${quoteId}`);
    expect(quoteRes.status()).toBe(200);
    const quote = QuoteView.parse(await quoteRes.json());
    expect(quote).toMatchObject({ orderable: true, trustLevel: 'BINDING', status: 'READY' });
    expect(quote.config).toMatchObject({ materialId: MATERIAL, thicknessOptionId: THICKNESS, finishServiceId: FINISH, quantity: QUANTITY });

    // ---- 3. Checkout form (server-priced: the request carries ids, never amounts) ----
    await page.getByTestId('checkout-email').fill('r1-buyer@example.com');
    await page.getByTestId('checkout-name').fill('Morgan Maker');
    await page.getByTestId('checkout-line1').fill('500 Market St');
    await page.getByTestId('checkout-city').fill('Philadelphia');
    await page.getByTestId('checkout-region').selectOption('PA');
    await page.getByTestId('checkout-postal').fill('19106');
    await page.getByTestId('shipping-option-STANDARD').click();
    await page.getByTestId('checkout-terms').check();
    const checkoutRequest = page.waitForRequest((r) => r.url().endsWith('/api/checkout') && r.method() === 'POST');
    await page.getByTestId('pay-cta').click();
    const sent = JSON.parse((await checkoutRequest).postData() ?? '{}') as Record<string, unknown>;
    expect(sent.quoteId).toBe(quoteId);
    expect(JSON.stringify(sent)).not.toMatch(/cents|amount|price|total/i);

    // ---- 4. Dev payment double -> signed order link -> tracker ----
    await page.getByTestId('dev-pay-button').click();
    await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 60_000 });
    const orderUrl = new URL(page.url());
    const orderId = orderUrl.pathname.split('/').pop()!;
    const token = orderUrl.searchParams.get('t')!;
    expect(token.length).toBeGreaterThan(20);
    await expect(page.getByTestId('order-status')).toContainText(/Paid · finding your shop|Waiting for the shop to accept/, { timeout: 30_000 });

    const paidView = OrderView.parse(await (await request.get(`/api/orders/${orderId}`, { headers: { 'x-order-token': token } })).json());
    expect(['PAID', 'DISPATCHED']).toContain(paidView.status);
    const orderNumber = paidView.orderNumber;

    // ---- 5. API: tampered / missing / foreign tokens are rejected exactly like a missing order ----
    expect((await request.get(`/api/orders/${orderId}?t=${encodeURIComponent(tamper(token))}`)).status()).toBe(404);
    expect((await request.get(`/api/orders/${orderId}`, { headers: { 'x-order-token': tamper(token) } })).status()).toBe(404);
    expect((await request.get(`/api/orders/${orderId}`)).status()).toBe(404);
    expect((await request.get(`/api/orders/ord_doesnotexist0000000000?t=${encodeURIComponent(token)}`)).status()).toBe(404);
    expect((await request.get(`/api/orders/${orderId}?t=${encodeURIComponent(token)}`)).status()).toBe(200);

    // ---- 6. Shop Console: login with the seeded token, accept the offered job ----
    const shop = await context.newPage();
    await shop.goto('/shop');
    await shop.getByTestId('shop-token-input').fill(E2E_SHOP_TOKEN);
    await shop.getByTestId('shop-login-submit').click();
    await shop.waitForURL(/\/shop\/jobs$/, { timeout: 30_000 });
    await shop.getByTestId('jobs-tab-offered').click();
    await shop.getByRole('link', { name: new RegExp(orderNumber) }).click();
    await shop.waitForURL(/\/shop\/jobs\/job_/);
    await confirm(shop, 'job-accept');
    await expect(shop.getByTestId('job-status-text')).toContainText('Accepted', { timeout: 20_000 });
    await expect(shop.getByTestId('packet-file')).toBeVisible();

    // ---- 7. Production milestones (the first one starts production) ----
    for (const kind of ['MATERIAL_STAGED', 'CUTTING', 'FINISHING', 'QA'] as const) {
        await confirm(shop, `milestone-${kind}`);
        await expect(shop.getByTestId(`milestone-${kind}`)).toHaveCount(0, { timeout: 20_000 });
    }
    await page.reload();
    await expect(page.getByTestId('order-timeline')).toContainText(/Production started/i, { timeout: 20_000 });

    // ---- 8. QA: measure every dimension at nominal, pass the visual checks, attach a photo ----
    await expect(shop.getByTestId('qa-form')).toBeVisible({ timeout: 20_000 });
    const checks = shop.locator('[data-testid^="qa-check-"]');
    const count = await checks.count();
    expect(count).toBeGreaterThan(2);
    for (let i = 0; i < count; i++) {
        const check = checks.nth(i);
        const measure = check.locator('[data-testid^="qa-measure-"]');
        if (await measure.count()) {
            const nominal = (await check.textContent())?.match(/nominal (-?[\d.]+)/)?.[1];
            await measure.fill(nominal ?? '0');
        } else {
            await check.locator('[data-testid^="qa-pass-"]').click();
        }
    }
    await shop.getByTestId('qa-photo-input').setInputFiles({ name: 'first-article.png', mimeType: 'image/png', buffer: PNG });
    await expect(shop.getByTestId('qa-photo').first()).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await shop.getByTestId('qa-inspector').fill('Jordan Inspector');
    await confirm(shop, 'qa-submit');
    await expect(shop.getByTestId('job-status-text')).toContainText('Passed inspection', { timeout: 20_000 });

    // ---- 9. Ship with manual tracking (CARRIER=manual double; the console only offers that mode) ----
    await expect(shop.getByTestId('ship-mode-label')).toBeDisabled();
    await shop.getByTestId('ship-carrier').fill('UPS');
    await shop.getByTestId('ship-service').fill('Ground');
    await shop.getByTestId('ship-tracking').fill(TRACKING);
    await confirm(shop, 'ship-submit');
    await expect(shop.getByTestId('shipment-card')).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId('order-status')).toContainText(/shipped/i, { timeout: 20_000 });
    await expect(page.getByTestId('tracking-number')).toHaveText(TRACKING);

    // ---- 10. Ops marks the order delivered through the admin API ----
    expect((await request.post(`/api/admin/orders/${orderId}/delivered`, { data: {} })).status()).toBe(401);
    const delivered = await request.post(`/api/admin/orders/${orderId}/delivered`, { headers: ADMIN, data: {} });
    expect(delivered.status()).toBe(200);
    expect(((await delivered.json()) as { status: string }).status).toBe('DELIVERED');

    // ---- 11. Buyer tracker: Delivered + passport link ----
    await page.reload();
    await expect(page.getByTestId('order-timeline')).toContainText('Delivered', { timeout: 20_000 });
    await expect(page.getByTestId('order-status')).toContainText(/complete|delivered/i);
    const passportCard = page.getByTestId('passport-card');
    await expect(passportCard).toBeVisible();
    const finalView = OrderView.parse(await (await request.get(`/api/orders/${orderId}`, { headers: { 'x-order-token': token } })).json());
    expect(finalView.status).toBe('COMPLETE');
    expect(finalView.passport?.id).toMatch(/^pps_/);

    // ---- 12. Passport page shows Verified (signature re-checked on read and on demand) ----
    await passportCard.click();
    await page.waitForURL(/\/passport\/pps_[A-Za-z0-9_-]+$/);
    await expect(page.getByTestId('passport-verified')).toBeVisible();
    await page.getByTestId('passport-verify').click();
    await expect(page.getByTestId('passport-verify-result')).toContainText('Valid');
    const verify = PassportVerifyResponse.parse(await (await request.get(`/api/passport/${finalView.passport!.id}/verify`)).json());
    expect(verify).toMatchObject({ valid: true, signatureValid: true, status: 'ACTIVE' });
    // The public passport carries no buyer PII.
    const publicPassport = await (await request.get(`/api/passport/${finalView.passport!.id}`)).text();
    expect(publicPassport).not.toContain('r1-buyer@example.com');
    expect(publicPassport).not.toContain('500 Market St');

    // ---- 13. Ledger: every transaction balances; payout recorded at shop cost ----
    const detail = await adminOrder(request, orderId);
    expect(detail.status).toBe('COMPLETE');
    expect(detail.statusHistory.map((h) => h.to)).toEqual(['PENDING_PAYMENT', 'PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED', 'SHIPPED', 'DELIVERED', 'COMPLETE']);
    const byTxn = new Map<string, number>();
    for (const l of detail.ledger) byTxn.set(l.txnKey, (byTxn.get(l.txnKey) ?? 0) + (l.direction === 'DEBIT' ? l.amountCents : -l.amountCents));
    expect([...byTxn.keys()].sort()).toEqual([`payment:${orderId}`, `payout:${orderId}:shop_philadelphia_precision`]);
    for (const [txn, net] of byTxn) expect(net, `ledger txn ${txn} must balance`).toBe(0);
    const cashIn = detail.ledger.filter((l) => l.account === 'CASH' && l.direction === 'DEBIT').reduce((s, l) => s + l.amountCents, 0);
    expect(cashIn).toBe(detail.totalCents);
    const shopPayable = detail.ledger.filter((l) => l.account === 'SHOP_PAYABLE').reduce((s, l) => s + (l.direction === 'DEBIT' ? l.amountCents : -l.amountCents), 0);
    expect(shopPayable).toBe(0);
    expect(detail.payouts).toHaveLength(1);
    const payoutLine = detail.ledger.find((l) => l.txnKey.startsWith('payout:') && l.account === 'PAYOUTS_IN_TRANSIT');
    expect(payoutLine?.amountCents).toBe(detail.payouts[0].amountCents);
    expect(detail.payouts[0]).toMatchObject({ shopId: 'shop_philadelphia_precision', status: 'PENDING', method: 'manual' });
    expect(detail.shipments).toEqual([expect.objectContaining({ status: 'DELIVERED', trackingNumber: TRACKING })]);
});
