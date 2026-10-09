/**
 * Stage 2 / R3 "Prime" customer experience, end to end with real state (dev payment provider,
 * manual carrier), at phone (390) and desktop (1280) widths:
 *   start a Prime trial on /prime → checkout shows free shipping → two parts (one with an
 *   engine-priced upsell) in the build cart → one payment → shop ships, ops delivers →
 *   map + carrier card on tracking → chat: "Where is my order?", the shop replies in the
 *   Shop Console, the buyer sees it → rating with a photo → ops approves → shop rating updates.
 */
import { expect, test, type Page } from '@playwright/test';
import { adminLogin, fulfil, shopLogin } from './support/journeys';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;

async function signInByEmail(page: Page, email: string) {
    const headers = { 'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` };
    const start = await (await page.request.post('/api/auth/email/start', { data: { email }, headers })).json();
    const verified = await page.request.post('/api/auth/email/verify', { data: { challengeId: start.challengeId, code: start.devCode }, headers });
    expect(verified.ok(), 'email sign-in').toBe(true);
}

/** Upload the sample plate and configure 6061 / 0.090" at `quantity` until the quote is binding. */
async function configure(page: Page, name: string, quantity: number) {
    await page.goto('/make');
    await page.getByTestId('upload-input').setInputFiles({ name, mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
    await page.getByTestId('material-option-mat_al_6061').click();
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
    await page.getByRole('button', { name: `Set quantity to ${quantity}`, exact: true }).click();
    await expect(page.getByTestId('checkout-cta')).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId('complete-your-build')).toBeVisible({ timeout: 15_000 });
}

for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    test(`Prime experience · ${label}`, async ({ browser }) => {
        test.setTimeout(600_000);
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const email = `prime-${label}-${Date.now()}@example.com`;
        await signInByEmail(page, email);

        // 1. Paywall: Copilot / Givingli trial timeline with real dates, plan toggle, honest copy.
        await page.goto('/prime');
        await expect(page.getByRole('heading', { level: 1, name: 'Claim your free trial' })).toBeVisible();
        await expect(page.getByTestId('trial-timeline').getByRole('listitem')).toHaveCount(3);
        await expect(page.getByTestId('prime-cancel-copy')).toContainText('Cancel in one tap');
        await page.getByTestId('plan-monthly').click();
        await page.getByTestId('prime-start-trial').click();
        await page.waitForURL(/\/me\/membership\?welcome=1/);
        await expect(page.getByTestId('membership-status')).toHaveText('Free trial');

        // 2. First part: add to the build cart, then checkout shows Prime free shipping.
        await configure(page, `prime-a-${label}.dxf`, 25);
        await page.getByTestId('add-to-cart').click();
        await expect(page.getByTestId('add-to-cart')).toContainText('In your build cart');
        await page.getByTestId('checkout-cta').click();
        await page.waitForURL(/\/checkout\/qte_/);
        await expect(page.getByTestId('prime-applied')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('checkout-shipping')).toHaveText('Free');

        // 3. Second part with a "Complete your build" upsell (hardware kit priced by the quote engine).
        await configure(page, `prime-b-${label}.dxf`, 10);
        const kit = page.getByTestId('upsell-hardware_kit');
        await expect(kit).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('upsell-hardware_kit-delta')).toContainText('+$');
        await page.getByTestId('upsell-hardware_kit-add').click();
        await expect(page.getByTestId('upsell-hardware_kit-add')).toContainText('Added');

        // 4. Floating cart pill (DoorDash) → cart → one payment for both parts.
        await page.goto('/make');
        await expect(page.getByTestId('cart-pill-count')).toHaveText('2');
        await page.getByTestId('cart-pill').click();
        await page.waitForURL(/\/cart$/);
        await expect(page.getByTestId('cart-item')).toHaveCount(2);
        await page.getByTestId('cart-name').fill('Prime Buyer');
        await page.getByTestId('cart-line1').fill('1 Market St');
        await page.getByTestId('cart-city').fill('San Francisco');
        await page.getByTestId('cart-region').selectOption('CA');
        await page.getByTestId('cart-postal').fill('94105');
        await expect(page.getByTestId('cart-email')).toHaveValue(email);
        await expect(page.getByTestId('cart-shipping-total')).toHaveText('Free', { timeout: 15_000 });
        await page.getByTestId('cart-terms').check();
        await page.getByTestId('cart-checkout-cta').click();
        await page.waitForURL(/\/checkout\/dev-pay\?ref=/, { timeout: 30_000 });
        await page.getByTestId('dev-pay-button').click();
        await page.waitForURL(/\/cart\/done\/cco_[A-Za-z0-9_-]+\?t=/, { timeout: 30_000 });
        await expect(page.getByTestId('cart-done-title')).toContainText('Paid', { timeout: 15_000 });
        const firstOrder = page.locator('[data-testid^="cart-done-order-"]').first();
        await expect(page.locator('[data-testid^="cart-done-order-"]')).toHaveCount(2);
        const orderNumber = (await firstOrder.getAttribute('data-testid'))!.replace('cart-done-order-', '');
        const orderUrl = (await firstOrder.getAttribute('href'))!;

        // 5. Shop accepts, makes, ships; ops marks delivered (shared journey helpers).
        const { jobUrl } = await fulfil(context, orderNumber, orderUrl);

        // 6. Tracking over a map with the carrier card and one status sentence (offline map in e2e).
        await page.goto(orderUrl);
        await expect(page.getByTestId('tracking-map')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('map-offline')).toBeVisible();
        await expect(page.getByTestId('carrier-card')).toContainText('1Z999AA10123456785');
        await expect(page.getByTestId('map-status')).toContainText(/Delivered/);

        // 7. Chat: buyer taps "Where is my order?", the shop replies in the Shop Console, the buyer sees it.
        await page.getByTestId('quick-reply-where_is_my_order').click();
        await expect(page.getByTestId('chat-message-system').first()).toBeVisible();
        // The Shop Console session from fulfil() is still on this context (the console redirects a signed-in shop).
        const shop = await context.newPage();
        await shop.goto(jobUrl);
        if (shop.url().endsWith('/shop')) await shopLogin(shop).then(() => shop.goto(jobUrl));
        await expect(shop.getByTestId('order-chat')).toBeVisible();
        await expect(shop.getByTestId('chat-message-buyer')).toContainText('Where is my order?');
        const reply = `Delivered yesterday, enjoy! (${label})`;
        await shop.getByTestId('chat-input').fill(reply);
        await shop.getByTestId('chat-send').click();
        await expect(shop.getByTestId('chat-message-shop')).toContainText(reply);
        await shop.close();
        await expect(page.getByTestId('chat-message-shop')).toContainText(reply, { timeout: 15_000 });

        // 8. Rate with a photo ("show what you made").
        await page.getByTestId('rating-star-5').click();
        await page.getByTestId('rating-tag-quality').click();
        await page.getByTestId('rating-caption').fill('Mounted on my robot arm');
        await page.getByTestId('rating-photo-input').setInputFiles({ name: 'made.png', mimeType: 'image/png', buffer: PNG });
        await expect(page.getByTestId('rating-photo-ready')).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('rating-submit').click();
        await expect(page.getByTestId('rating-status')).toContainText('in review');

        // 9. Ops approves in the moderation queue; the shop rating updates.
        const ops = await context.newPage();
        await adminLogin(ops);
        await ops.getByTestId('ops-prime-link').click();
        await ops.waitForURL(/\/admin\/prime$/);
        await expect(ops.getByTestId(`moderation-item-${orderNumber}`)).toBeVisible({ timeout: 15_000 });
        await ops.getByTestId(`moderate-approve-${orderNumber}`).click();
        await expect(ops.getByTestId('prime-admin-notice')).toContainText('approved');
        await ops.close();
        await page.goto(orderUrl);
        await expect(page.getByTestId('rating-status')).toContainText('Published', { timeout: 15_000 });
        await expect(page.getByTestId('shop-card')).toContainText(/★?\s*5\.0|5\.0/);
        await context.close();
    });
}
