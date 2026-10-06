/**
 * R1 acceptance journey through the real UI and APIs (no mocked state):
 * upload DXF -> configure -> binding quote -> checkout -> dev payment -> dispatch
 * -> Shop Console accept -> milestones -> QA pass -> ship (manual carrier)
 * -> ops marks delivered -> passport active + verified.
 *
 * Runs with the explicit test doubles from playwright.config.ts
 * (PAYMENT_PROVIDER=dev, CARRIER=manual); both refuse NODE_ENV=production.
 */
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_TOKEN, E2E_SHOP_TOKEN } from '../../playwright.config';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';

// 1x1 transparent PNG used as the inspection photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function confirm(page: Page, testId: string) {
    await page.getByTestId(testId).click();
    await page.getByTestId(`${testId}-confirm`).click();
}

test('a customer runs a real order end to end', async ({ page, context }) => {
    // ---- Upload ----
    await page.goto('/');
    await page.getByTestId('upload-input').setInputFiles({ name: 'e2e-plate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });

    // ---- Configure + binding quote ----
    const cta = page.getByTestId('checkout-cta');
    await expect(cta).toContainText('Make 2 required selections');
    await page.getByTestId('material-option-mat_al_6061').click();
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
    await expect(cta).toContainText('Continue to checkout', { timeout: 15_000 });
    await cta.click();
    await page.waitForURL(/\/checkout\/qte_/);

    // ---- Checkout (server-priced) ----
    await page.getByTestId('checkout-email').fill('e2e-buyer@example.com');
    await page.getByTestId('checkout-name').fill('Avery Buyer');
    await page.getByTestId('checkout-line1').fill('1 Market St');
    await page.getByTestId('checkout-city').fill('San Francisco');
    await page.getByTestId('checkout-region').selectOption('CA');
    await page.getByTestId('checkout-postal').fill('94105');
    await page.getByTestId('shipping-option-STANDARD').click();
    await page.getByTestId('checkout-terms').check();
    await page.getByTestId('pay-cta').click();

    // ---- Dev payment double -> signed order link ----
    await page.getByTestId('dev-pay-button').click();
    await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 30_000 });
    const orderUrl = page.url();
    await expect(page.getByTestId('order-status')).toContainText(/waiting for the shop/i, { timeout: 30_000 });
    const orderNumber = (await page.locator('text=/DMO-[A-Z0-9]+/').first().textContent())?.match(/DMO-[A-Z0-9]+/)?.[0];
    expect(orderNumber).toBeTruthy();

    // ---- Shop Console ----
    const shop = await context.newPage();
    await shop.goto('/shop');
    await shop.getByTestId('shop-token-input').fill(E2E_SHOP_TOKEN);
    await shop.getByTestId('shop-login-submit').click();
    await shop.waitForURL(/\/shop\/jobs$/);
    await shop.getByTestId('jobs-tab-offered').click();
    await shop.getByRole('link', { name: new RegExp(orderNumber!) }).click();
    await shop.waitForURL(/\/shop\/jobs\/job_/);

    await confirm(shop, 'job-accept');
    await expect(shop.getByTestId('job-status-text')).toContainText('Accepted', { timeout: 15_000 });

    for (const kind of ['MATERIAL_STAGED', 'CUTTING', 'QA'] as const) {
        await confirm(shop, `milestone-${kind}`);
        await expect(shop.getByTestId(`milestone-${kind}`)).toHaveCount(0, { timeout: 15_000 });
    }
    await expect(page.getByTestId('order-status')).toContainText(/ now /i, { timeout: 15_000 });

    // ---- QA: measure every check at nominal, pass the visual ones, attach a photo ----
    await expect(shop.getByTestId('qa-form')).toBeVisible({ timeout: 15_000 });
    const checks = shop.locator('[data-testid^="qa-check-"]');
    const count = await checks.count();
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
    await shop.getByTestId('qa-photo-input').setInputFiles({ name: 'inspection.png', mimeType: 'image/png', buffer: PNG });
    await expect(shop.getByTestId('qa-photo').first()).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
    await shop.getByTestId('qa-inspector').fill('Jordan Inspector');
    await confirm(shop, 'qa-submit');
    await expect(shop.getByTestId('job-status-text')).toContainText('Passed inspection', { timeout: 15_000 });

    // ---- Ship (manual carrier test double) ----
    await shop.getByTestId('ship-mode-manual').click();
    await shop.getByTestId('ship-carrier').fill('UPS');
    await shop.getByTestId('ship-service').fill('Ground');
    await shop.getByTestId('ship-tracking').fill('1Z999AA10123456784');
    await confirm(shop, 'ship-submit');
    await expect(shop.getByTestId('shipment-card')).toBeVisible({ timeout: 15_000 });

    await page.goto(orderUrl);
    await expect(page.getByTestId('order-status')).toContainText(/shipped/i, { timeout: 15_000 });
    await expect(page.getByTestId('tracking-number')).toHaveText('1Z999AA10123456784');

    // ---- Ops confirms delivery -> passport + payouts ----
    const ops = await context.newPage();
    await ops.goto('/admin');
    await ops.getByTestId('admin-token-input').fill(E2E_ADMIN_TOKEN);
    await ops.getByTestId('admin-login-submit').click();
    await ops.getByTestId(`admin-order-${orderNumber}`).click();
    await confirm(ops, 'admin-mark-delivered');

    await expect(page.getByTestId('order-status')).toContainText(/complete|delivered/i, { timeout: 20_000 });
    await page.getByTestId('passport-card').click();
    await page.waitForURL(/\/passport\/pps_/);
    await expect(page.getByTestId('passport-verified')).toBeVisible();
    await page.getByTestId('passport-verify').click();
    await expect(page.getByTestId('passport-verify-result')).toContainText('Valid');
});
