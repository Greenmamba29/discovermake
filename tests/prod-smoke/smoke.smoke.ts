/**
 * Production-mode smoke: the app built with `next build`, started with `next start` and the
 * same configuration as the live Netlify site (secrets, APP_URL; no Stripe, S3, EasyPost,
 * Resend, Make AI or CAD worker). Visits every page and the main buyer flow as a guest and
 * records anything a user would see break: 5xx responses, console errors, error pages.
 */
import { test, expect, type Page } from '@playwright/test';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';

const PAGES = ['/', '/make', '/make/ai', '/discover', '/live', '/prime', '/builds', '/orders', '/cart', '/signin', '/onboarding', '/reconstruct', '/me', '/me/membership', '/family', '/studio', '/shop', '/admin', '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/prohibited-items', '/kids'];

type Problem = { where: string; what: string };
const problems: Problem[] = [];

function watch(page: Page, where: () => string) {
    page.on('console', (m) => {
        if (m.type() === 'error') problems.push({ where: where(), what: `console: ${m.text().slice(0, 300)}` });
    });
    page.on('pageerror', (e) => problems.push({ where: where(), what: `pageerror: ${e.message.slice(0, 300)}` }));
    page.on('response', (r) => {
        if (r.status() === 404) problems.push({ where: where(), what: `404 ${r.request().method()} ${new URL(r.url()).pathname}` });
        if (r.status() >= 500) problems.push({ where: where(), what: `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}` });
    });
}

test.afterAll(() => {
    console.log('\n=== PROBLEMS ===\n' + (problems.length ? problems.map((p) => `${p.where} :: ${p.what}`).join('\n') : 'none'));
});

for (const path of PAGES) {
    test(`page ${path}`, async ({ page }) => {
        watch(page, () => path);
        const res = await page.goto(path, { waitUntil: 'networkidle' });
        const status = res?.status() ?? 0;
        const body = await page.locator('body').innerText();
        if (status >= 500 || /Application error|Internal Server Error|Something went wrong/i.test(body)) problems.push({ where: path, what: `page ${status}: ${body.slice(0, 200).replace(/\s+/g, ' ')}` });
        expect(status).toBeLessThan(500);
    });
}

test('/make/ai never 404s (switched off it explains and links to the DXF upload)', async ({ page, request }) => {
    const res = await page.goto('/make/ai');
    expect(res?.status()).toBe(200);
    const health = await (await request.get('/api/health')).json();
    if (!health.configured.makeAi) await expect(page.getByTestId('make-ai-off')).toBeVisible();
});

test('health', async ({ request }) => {
    const r = await request.get('/api/health');
    const j = await r.json();
    console.log('health', r.status(), JSON.stringify(j));
    expect(r.status()).toBe(200);
});

test('guest buyer: upload DXF -> part -> quote -> checkout', async ({ page }) => {
    watch(page, () => 'buyer-flow ' + new URL(page.url()).pathname);
    await page.goto('/');
    await page.getByTestId('upload-input').setInputFiles({ name: 'plate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
    await page.waitForURL(/\/parts\/prt_/, { timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    console.log('part page:', (await page.locator('main').innerText()).slice(0, 600).replace(/\s+/g, ' '));
    const firstMaterial = page.locator('[data-testid^="material-option-"]').first();
    if (await firstMaterial.count()) await firstMaterial.click();
    await page.waitForTimeout(4000);
    console.log('after material:', (await page.locator('main').innerText()).slice(0, 800).replace(/\s+/g, ' '));
    const cta = page.getByTestId('checkout-cta');
    if (await cta.isVisible() && await cta.isEnabled()) {
        await cta.click();
        await page.waitForURL(/\/checkout\/qte_/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle');
        await page.getByTestId('checkout-email').waitFor({ timeout: 30_000 });
        await page.getByTestId('checkout-email').fill('smoke-buyer@example.com');
        await page.getByTestId('checkout-name').fill('Smoke Buyer');
        await page.getByTestId('checkout-line1').fill('1 Market St');
        await page.getByTestId('checkout-city').fill('San Francisco');
        await page.getByTestId('checkout-region').selectOption('CA');
        await page.getByTestId('checkout-postal').fill('94105');
        await page.waitForTimeout(3000);
        const ship = page.locator('[data-testid^="shipping-option-"]').first();
        if (await ship.isVisible()) await ship.click();
        else problems.push({ where: 'checkout', what: 'no shipping options shown' });
        await page.getByTestId('checkout-terms').check();
        const health = await (await page.request.get('/api/health')).json();
        if (health.configured.payments === false) {
            // Not connected: the page says so up front and the pay button is off (no dead-end submit).
            await expect(page.getByTestId('payments-unavailable')).toBeVisible();
            await expect(page.getByTestId('pay-cta')).toBeDisabled();
        } else {
            await page.getByTestId('pay-cta').click();
            await page.waitForTimeout(6000);
        }
        const alerts = await page.locator('[role=alert]').allInnerTexts();
        console.log('checkout:', page.url(), 'alerts:', JSON.stringify(alerts.filter(Boolean)));
    } else if (await page.getByTestId('catalog-empty').isVisible()) {
        problems.push({ where: 'buyer-flow', what: 'no partner shop is live: the catalog is empty, so nothing can be priced' });
    } else problems.push({ where: 'buyer-flow', what: 'no orderable quote (checkout CTA missing/disabled)' });
});

test('sign-in with email', async ({ page }) => {
    watch(page, () => 'signin');
    await page.goto('/signin');
    const email = page.locator('input[type=email]').first();
    await email.fill('smoke@example.com');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    console.log('signin after submit:', (await page.locator('main').innerText()).slice(0, 500).replace(/\s+/g, ' '));
});

test('static site files: icon, robots.txt, sitemap.xml', async ({ request }) => {
    for (const path of ['/favicon.ico', '/icon.svg', '/robots.txt', '/sitemap.xml']) {
        const r = await request.get(path);
        if (r.status() !== 200) problems.push({ where: path, what: `static ${r.status()}` });
        expect(r.status(), path).toBe(200);
    }
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /api/');
});

test('checkout says ordering is not open while payments are not connected', async ({ request }) => {
    const health = await (await request.get('/api/health')).json();
    test.skip(health.configured.payments !== false, 'payments are connected here');
    const r = await request.post('/api/checkout', { data: {} });
    // Validation runs first; the point is it never 500s.
    expect(r.status()).toBeLessThan(500);
});

test('scheduled job routes answer the cron secret (PROD_SMOKE_CRON_SECRET)', async ({ request }) => {
    const secret = process.env.PROD_SMOKE_CRON_SECRET;
    test.skip(!secret, 'set PROD_SMOKE_CRON_SECRET to check the scheduled job routes');
    const routes = ['/api/admin/offers/expire', '/api/admin/outbox/publish', '/api/admin/live/drops/close', '/api/admin/live/auctions/close', '/api/admin/creator-payouts/run', '/api/admin/promise/retrain', '/api/admin/prime/trial-reminders'];
    for (const route of routes) {
        const r = await request.get(route, { headers: { authorization: `Bearer ${secret}` } });
        console.log('cron', route, r.status(), (await r.text()).slice(0, 160));
        if (r.status() !== 200) problems.push({ where: route, what: `cron ${r.status()}` });
        expect(r.status(), route).toBe(200);
    }
    expect((await request.get(routes[0])).status()).toBe(401);
});

test('shop console logs in with a console token (PROD_SMOKE_SHOP_TOKEN)', async ({ page }) => {
    const token = process.env.PROD_SMOKE_SHOP_TOKEN;
    test.skip(!token, 'set PROD_SMOKE_SHOP_TOKEN to check the Shop Console');
    watch(page, () => 'shop-console');
    const r = await page.request.post('/api/shop/session', { data: { token } });
    expect(r.status()).toBeLessThan(300);
    await page.goto('/shop/jobs', { waitUntil: 'networkidle' });
    expect(page.url()).toContain('/shop');
});

// The three "no file handy" entry points share the DXF upload pipeline (POST /api/parts -> signed
// PUT -> analyze). These were the screens that failed on the live site, so each is checked on its own.

test('sample part ("No file handy? Try a sample mounting plate") reaches the configurator', async ({ page }) => {
    watch(page, () => 'sample-part ' + new URL(page.url()).pathname);
    await page.goto('/make');
    await page.getByTestId('sample-part').click();
    await page.waitForURL(/\/parts\/prt_/, { timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('upload-error')).toHaveCount(0);
    await expect(page.getByTestId('part-problem')).toHaveCount(0);
    await expect(page.getByTestId('part-dimensions')).toContainText('120.0 mm');
});

test('Discover "Get an instant quote" on the wall bracket reaches the configurator', async ({ page }) => {
    watch(page, () => 'discover-start ' + new URL(page.url()).pathname);
    await page.goto('/discover');
    await page.getByTestId('discover-start-wall-bracket').first().click();
    await page.waitForURL(/\/parts\/prt_/, { timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('part-problem')).toHaveCount(0);
    const body = await page.locator('main').innerText();
    expect(body).not.toMatch(/Internal error/i);
});

test('onboarding step 3 prices the sample (or says honestly why it cannot)', async ({ page }) => {
    watch(page, () => 'onboarding ' + new URL(page.url()).pathname);
    await page.goto('/onboarding');
    await page.getByTestId('intent-option-make').click();
    await page.getByTestId('onboarding-continue').click();
    await page.getByTestId('onboarding-skip').click(); // interests: Skip is on every step
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'first-build', { timeout: 15_000 });
    const result = page.getByTestId('first-build-price').or(page.getByText('We could not price the sample'));
    await expect(result).toBeVisible({ timeout: 90_000 });
    const text = await page.getByTestId('onboarding').innerText();
    // With no partner shop the honest state is "could not price"; "Internal error" is never acceptable.
    expect(text).not.toMatch(/Internal error/i);
    if (await page.getByTestId('first-build-price').isVisible()) console.log('first build priced:', await page.getByTestId('first-build-price').innerText());
    else problems.push({ where: 'onboarding step 3', what: `not priced: ${text.match(/We could not price the sample[\s\S]{0,120}/)?.[0]?.replace(/\s+/g, ' ')}` });
});
