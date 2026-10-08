/**
 * Shared e2e journeys that build REAL state through the UI (no seeded fakes), so page
 * sweeps can visit every screen with data on it. Each helper returns the URLs it created.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ADMIN_TOKEN, E2E_SHOP_TOKEN } from '../../../playwright.config';
import { sampleBracketDxf } from '../../../src/lib/sample-dxf';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export async function confirm(page: Page, testId: string) {
    await page.getByTestId(testId).click();
    await page.getByTestId(`${testId}-confirm`).click();
}

/** Upload a DXF and configure it to a BINDING quote. */
export async function quotePart(page: Page, name = 'sweep-plate.dxf') {
    await page.goto('/');
    await page.getByTestId('upload-input').setInputFiles({ name, mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
    const partUrl = new URL(page.url()).pathname;
    await page.getByTestId('material-option-mat_al_6061').click();
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
    await page.getByTestId('checkout-cta').click();
    await page.waitForURL(/\/checkout\/qte_/);
    const checkoutUrl = new URL(page.url()).pathname;
    const quoteId = checkoutUrl.match(/qte_[A-Za-z0-9_-]+/)![0];
    return { partUrl, partId: partUrl.split('/').pop()!, checkoutUrl, quoteId };
}

/** From the checkout page: pay with the dev double and land on the signed order link. */
export async function payOrder(page: Page) {
    await page.getByTestId('checkout-email').fill('sweep-buyer@example.com');
    await page.getByTestId('checkout-name').fill('Sweep Buyer');
    await page.getByTestId('checkout-line1').fill('1 Market St');
    await page.getByTestId('checkout-city').fill('San Francisco');
    await page.getByTestId('checkout-region').selectOption('CA');
    await page.getByTestId('checkout-postal').fill('94105');
    await page.getByTestId('shipping-option-STANDARD').click();
    await page.getByTestId('checkout-terms').check();
    await page.getByTestId('pay-cta').click();
    await page.getByTestId('dev-pay-button').click();
    await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 30_000 });
    const orderUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
    await expect(page.getByTestId('order-status')).toContainText(/waiting for the shop/i, { timeout: 30_000 });
    const orderNumber = (await page.locator('text=/DMO-[A-Z0-9]+/').first().textContent())!.match(/DMO-[A-Z0-9]+/)![0];
    return { orderUrl, orderNumber };
}

export async function shopLogin(page: Page) {
    await page.goto('/shop');
    await page.getByTestId('shop-token-input').fill(E2E_SHOP_TOKEN);
    await page.getByTestId('shop-login-submit').click();
    await page.waitForURL(/\/shop\/jobs$/);
}

export async function adminLogin(page: Page) {
    await page.goto('/admin');
    await page.getByTestId('admin-token-input').fill(E2E_ADMIN_TOKEN);
    await page.getByTestId('admin-login-submit').click();
}

/** Shop accepts, runs milestones, passes QA and ships; ops marks delivered. Returns the job and passport URLs. */
export async function fulfil(context: BrowserContext, orderNumber: string, orderUrl: string) {
    const shop = await context.newPage();
    await shopLogin(shop);
    await shop.getByTestId('jobs-tab-offered').click();
    await shop.getByRole('link', { name: new RegExp(orderNumber) }).click();
    await shop.waitForURL(/\/shop\/jobs\/job_/);
    const jobUrl = new URL(shop.url()).pathname;
    await confirm(shop, 'job-accept');
    await expect(shop.getByTestId('job-status-text')).toContainText('Accepted', { timeout: 15_000 });
    for (const kind of ['MATERIAL_STAGED', 'CUTTING', 'QA'] as const) {
        await confirm(shop, `milestone-${kind}`);
        await expect(shop.getByTestId(`milestone-${kind}`)).toHaveCount(0, { timeout: 15_000 });
    }
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
    await shop.getByTestId('qa-photo-input').setInputFiles({ name: 'inspection.png', mimeType: 'image/png', buffer: PNG });
    await expect(shop.getByTestId('qa-photo').first()).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
    await shop.getByTestId('qa-inspector').fill('Sweep Inspector');
    await confirm(shop, 'qa-submit');
    await expect(shop.getByTestId('job-status-text')).toContainText('Passed inspection', { timeout: 15_000 });
    await shop.getByTestId('ship-mode-manual').click();
    await shop.getByTestId('ship-carrier').fill('UPS');
    await shop.getByTestId('ship-service').fill('Ground');
    await shop.getByTestId('ship-tracking').fill('1Z999AA10123456785');
    await confirm(shop, 'ship-submit');
    await expect(shop.getByTestId('shipment-card')).toBeVisible({ timeout: 15_000 });
    await shop.close();

    const ops = await context.newPage();
    await adminLogin(ops);
    await ops.getByTestId(`admin-order-${orderNumber}`).click();
    await confirm(ops, 'admin-mark-delivered');
    await expect(ops.getByText(`${orderNumber} marked delivered.`)).toBeVisible({ timeout: 20_000 });
    await ops.close();

    const buyer = await context.newPage();
    await expect(async () => {
        await buyer.goto(orderUrl);
        await expect(buyer.getByTestId('order-status')).toContainText(/complete|delivered/i, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await buyer.getByTestId('passport-card').click();
    await buyer.waitForURL(/\/passport\/pps_/);
    const passportUrl = new URL(buyer.url()).pathname;
    await buyer.close();
    return { jobUrl, passportUrl };
}
