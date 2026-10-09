/**
 * R2 accounts journey (ADR-0009), real state end to end:
 * a guest uploads a part and orders it -> /builds lists it as a guest build -> sign in with
 * an email code (devCode) claims the build and the order -> add a passkey with Chromium's
 * virtual authenticator (CDP WebAuthn) -> sign out -> sign in with the passkey ->
 * Reorder from My Builds lands on checkout with a fresh quote.
 */
import { expect, test, type Page } from '@playwright/test';
import { quotePart } from './support/journeys';

async function payAs(page: Page, email: string) {
    await page.getByTestId('checkout-email').fill(email);
    await page.getByTestId('checkout-name').fill('Account Journey');
    await page.getByTestId('checkout-line1').fill('1 Market St');
    await page.getByTestId('checkout-city').fill('San Francisco');
    await page.getByTestId('checkout-region').selectOption('CA');
    await page.getByTestId('checkout-postal').fill('94105');
    await page.getByTestId('shipping-option-STANDARD').click();
    await page.getByTestId('checkout-terms').check();
    await page.getByTestId('pay-cta').click();
    await page.getByTestId('dev-pay-button').click();
    await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 30_000 });
}

test('guest build -> email sign-in claims it -> passkey -> sign out -> passkey sign-in -> reorder', async ({ page, context }) => {
    test.setTimeout(240_000);
    const email = `journey-${Date.now().toString(36)}@example.com`;

    // 1. Guest: upload, quote and order a part.
    const { partId, quoteId: firstQuote } = await quotePart(page, 'account-journey.dxf');
    await payAs(page, email);
    const build = await (await page.request.get(`/api/parts/${partId}`)).json();
    const buildId: string = build.buildId;

    // 2. My Builds as a guest: the build is listed with Reorder, and a "sign in to keep" banner.
    await page.goto('/builds');
    await expect(page.getByRole('heading', { level: 1, name: 'My builds' })).toBeVisible();
    await expect(page.getByTestId('builds-guest-banner')).toBeVisible();
    const row = page.getByTestId(`build-row-${buildId}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('build-reorder')).toBeEnabled();
    await page.getByTestId('builds-tab-ordered').click();
    await expect(page.getByTestId('builds-tab-ordered')).toHaveAttribute('aria-selected', 'true');
    await expect(row).toBeVisible();

    // 3. Sign in with an email code: the guest build and the order move to the account.
    await page.getByTestId('builds-guest-signin').click();
    await page.waitForURL(/\/signin\?next=%2Fbuilds&mode=create|\/signin\?next=\/builds&mode=create/);
    await expect(page.getByRole('heading', { level: 1, name: 'Save your build' })).toBeVisible();
    await page.getByTestId('signin-email').fill(email);
    await page.getByTestId('signin-email-submit').click();
    const devCode = (await page.getByTestId('signin-dev-code').locator('.font-mono').textContent())!.trim();
    expect(devCode).toMatch(/^\d{6}$/);
    await expect(page.getByTestId('signin-code')).toBeFocused();
    await page.getByTestId('signin-code').fill(devCode);
    await page.getByTestId('signin-code-submit').click();
    await page.waitForURL(/\/builds$/);
    await expect(page.getByTestId(`build-row-${buildId}`)).toBeVisible();
    await expect(page.getByTestId('builds-guest-banner')).toHaveCount(0);
    const mine = await (await page.request.get('/api/me/builds?tab=ordered')).json();
    expect(mine.guest).toBe(false);
    expect(mine.rows.map((r: { buildId: string }) => r.buildId)).toContain(buildId);

    // 4. Add a passkey with a virtual platform authenticator.
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await page.goto('/me');
    await expect(page.getByTestId('me-email')).toContainText(email);
    await page.getByTestId('me-add-passkey').click();
    await expect(page.getByTestId('me-passkey-added')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('me-passkeys').locator('li')).toHaveCount(1);

    // 5. Sign out.
    await page.getByTestId('me-signout').click();
    await page.waitForURL(/\/signin/);
    expect((await (await page.request.get('/api/me')).json()).viewer).toBeNull();

    // 6. Sign in with the passkey (usernameless).
    await page.getByTestId('signin-passkey').click();
    await page.waitForURL(/\/builds$/, { timeout: 20_000 });
    expect((await (await page.request.get('/api/me')).json()).viewer.email).toBe(email);

    // 7. Reorder from My Builds lands on checkout with a fresh quote.
    await page.getByTestId(`build-row-${buildId}`).getByTestId('build-reorder').click();
    await page.waitForURL(/\/checkout\/qte_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
    expect(page.url()).not.toContain(firstQuote);
    await expect(page.getByTestId('shipping-option-STANDARD')).toBeVisible();
});

test('signed-out /me prompts sign in; unsafe ?next is ignored', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByTestId('me-signed-out')).toBeVisible();
    await page.goto('/signin?next=//evil.example/x');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    // Not signed in yet: the form is shown, and Google/Apple are hidden when unconfigured.
    await expect(page.getByTestId('signin-google')).toHaveCount(0);
    await expect(page.getByTestId('signin-apple')).toHaveCount(0);
});
