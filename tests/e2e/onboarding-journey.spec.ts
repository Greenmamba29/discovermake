/**
 * Stage 1 journeys for the app shell, Home intake, onboarding and Discover (workflow 10/14):
 * - phone: Home → "Take the tour" → intent → pick 5 → first build shows a BINDING price within
 *   5 s → "Not now" → Home; the bottom nav moves between Discover / Make / Builds / Me;
 * - desktop: the bottom nav is hidden and the top nav works;
 * - typed intake text lands on Make AI prefilled;
 * - a Discover starter card starts a real instant quote.
 * Real state only: the first build and the Discover card go through the real upload → analyze →
 * quote API.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL } from '../../playwright.config';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/**
 * `next dev` compiles each route on first hit. Warm the quote API and the pages once so the
 * "under 5 seconds" check measures the product, not the dev compiler.
 */
async function warmUp(request: APIRequestContext) {
    const bytes = Buffer.from(sampleBracketDxf());
    const created = await (await request.post('/api/parts', { data: { filename: 'warmup.dxf', contentType: 'application/dxf', sizeBytes: bytes.byteLength } })).json();
    await request.put(created.upload.url, { data: bytes, headers: created.upload.headers });
    await request.post(`/api/parts/${created.partId}/analyze`, { data: {} });
    await request.post('/api/quotes', { data: { partId: created.partId, materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', finishServiceId: null, services: [], quantity: 1 } });
    for (const path of ['/', '/onboarding', '/discover', '/make', '/make/ai', '/orders', '/api/me', '/api/me/builds?limit=4']) await request.get(path);
}

test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    const request = await playwright.request.newContext({ baseURL: E2E_BASE_URL });
    await warmUp(request);
    await request.dispose();
});

// The `next dev` route indicator floats over the bottom-left corner, i.e. over the first tab.
// It does not exist in production builds; hide it so taps reach the bottom nav.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = 'nextjs-portal { display: none !important; }';
            document.head.appendChild(style);
        });
    });
});

test.describe('phone (390px)', () => {
    test.use({ viewport: PHONE });

    test('home → tour → intent → pick 5 → binding first build in under 5 s → Not now → home', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1, name: 'What do you want to make?' })).toBeVisible();
        await page.getByTestId('tour-start').click();
        await page.waitForURL('**/onboarding');

        // Step 1: intent (Blinkist "Step 1 of 4").
        await expect(page.getByRole('heading', { level: 1, name: 'What brings you here?' })).toBeVisible();
        await expect(page.getByTestId('onboarding-progress')).toHaveText('Step 1 of 4');
        await expect(page.getByTestId('bottom-nav')).toHaveCount(0);
        await expect(page.getByTestId('onboarding-continue')).toBeDisabled();
        await page.getByTestId('intent-option-make').click();
        await page.getByTestId('onboarding-continue').click();

        // Step 2: pick 5 (Pinterest), gated until five.
        await expect(page.getByRole('heading', { level: 1, name: 'Pick 5 things you love to make' })).toBeVisible();
        for (const slug of ['brackets-mounts', 'enclosures', 'robotics']) await page.getByTestId(`interest-chip-${slug}`).click();
        await expect(page.getByTestId('interest-count')).toHaveText('3 of 5 picked');
        await expect(page.getByTestId('onboarding-continue')).toBeDisabled();
        for (const slug of ['desk-setup', 'bikes']) await page.getByTestId(`interest-chip-${slug}`).click();
        await expect(page.getByTestId('interest-count')).toHaveText('5 picked');
        await page.getByTestId('onboarding-continue').click();

        // Step 3: first build, a real binding quote in under 5 s.
        await expect(page.getByRole('heading', { level: 1, name: 'A real price in seconds' })).toBeVisible();
        const started = Date.now();
        await expect(page.getByTestId('first-build-price')).toBeVisible({ timeout: 5_000 });
        expect(Date.now() - started).toBeLessThan(5_000);
        await expect(page.getByTestId('first-build-price')).toHaveText(/^\$\d[\d,]*\.\d{2}$/);
        await expect(page.getByTestId('first-build').getByTestId('trust-chip')).toContainText('Binding quote');

        // A refresh resumes on the same step with the same quote (no second upload).
        const price = await page.getByTestId('first-build-price').textContent();
        await page.reload();
        await expect(page.getByTestId('first-build-price')).toHaveText(price!);
        await page.getByTestId('onboarding-continue').click();

        // Step 4: save with a passkey, or Not now.
        await expect(page.getByRole('heading', { level: 1, name: 'Save your build' })).toBeVisible();
        await expect(page.getByTestId('onboarding-passkey')).toHaveAttribute('href', '/signin?mode=create&next=/builds');
        await page.getByTestId('onboarding-not-now').click();
        await page.waitForURL((url) => url.pathname === '/');
        await expect(page.getByRole('heading', { level: 1, name: 'What do you want to make?' })).toBeVisible();
        await expect(page.getByTestId('tour-entry')).toHaveCount(0);
    });

    test('the bottom nav moves between Discover, Make, Builds and Me', async ({ page }) => {
        await page.goto('/');
        const bar = page.getByTestId('bottom-nav');
        await expect(bar).toBeVisible();
        await expect(page.getByTestId('top-nav')).toBeHidden();
        for (const [key, path] of [
            ['discover', '/discover'],
            ['make', '/make'],
            ['builds', '/builds'],
            ['me', '/me'],
        ] as const) {
            await page.getByTestId(`bottom-nav-${key}`).click();
            await page.waitForURL((url) => url.pathname === path);
            await expect(page.getByTestId(`bottom-nav-${key}`)).toHaveAttribute('aria-current', 'page');
            await expect(page.locator('[data-testid^="bottom-nav-"][aria-current="page"]')).toHaveCount(1);
        }
        // Content is never hidden behind the bar: the page's last element clears it.
        await page.goto('/discover');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const footerBottom = await page.locator('footer').evaluate((el) => el.getBoundingClientRect().bottom);
        const barTop = await bar.evaluate((el) => el.getBoundingClientRect().top);
        expect(footerBottom).toBeLessThanOrEqual(barTop + 1);
    });

    test('typed intake text lands on Make AI prefilled', async ({ page }) => {
        await page.goto('/');
        const prompt = 'A powder-coated steel wall bracket for a 600 mm shelf, 4 of them';
        await page.getByTestId('intake-text').fill(prompt);
        await page.getByTestId('intake-text').press('Enter');
        await page.waitForURL(/\/make\/ai\?prompt=/);
        await expect(page.getByLabel('What do you want to make?')).toHaveValue(prompt);
    });

    test('a Make-anything tile opens Make AI with a process starter prompt', async ({ page }) => {
        await page.goto('/');
        await page.getByTestId('make-tile-cnc').getByRole('link').click();
        await page.waitForURL(/\/make\/ai\?prompt=/);
        await expect(page.getByLabel('What do you want to make?')).toHaveValue(/CNC-machined/);
    });
});

test.describe('desktop (1280px)', () => {
    test.use({ viewport: DESKTOP });

    test('the bottom nav is hidden and the top nav works', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('bottom-nav')).toBeHidden();
        const top = page.getByTestId('top-nav');
        await expect(top).toBeVisible();
        await expect(top.getByRole('link', { name: 'Upload a part' })).toBeVisible();
        await expect(page.getByTestId('top-nav-account')).toHaveText(/Sign in|Me/);

        await page.getByTestId('top-nav-discover').click();
        await page.waitForURL('**/discover');
        await expect(page.getByRole('heading', { level: 1, name: 'Watch it made. Make it yours.' })).toBeVisible();
        await expect(page.getByTestId('top-nav-discover')).toHaveAttribute('aria-current', 'page');

        await page.getByTestId('top-nav-make').click();
        await page.waitForURL('**/make');
        await expect(page.getByTestId('upload-input')).toBeAttached();

        await page.getByTestId('top-nav-track').click();
        await page.waitForURL('**/orders');
        await expect(page.getByTestId('top-nav-track')).toHaveAttribute('aria-current', 'page');

        await page.getByTestId('top-nav-builds').click();
        await page.waitForURL('**/builds');
    });

    test('a Discover starter card starts a real instant quote', async ({ page }) => {
        await page.goto('/discover');
        await page.getByTestId('discover-start-wall-bracket').click();
        await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+\?from=qte_/, { timeout: 30_000 });
        await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
        await expect(page.getByTestId('checkout-cta')).toContainText(/Continue to checkout · \$/);
    });

    test('a bent Discover starter opens with bending already priced', async ({ page }) => {
        await page.goto('/discover');
        await page.getByTestId('discover-start-shelf-bracket').click();
        await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+\?from=qte_/, { timeout: 30_000 });
        await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
        await expect(page.getByTestId('checkout-cta')).toContainText(/Continue to checkout · \$/);
    });
});
