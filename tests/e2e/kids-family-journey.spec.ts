/**
 * Kids & Family, at phone (390 px) and desktop (1280 px) width:
 *   a grown-up signs in (email code, dev flow) -> /family -> adds kid "Mia" (10-12) and a PIN ->
 *   Hand to Mia -> Mia picks Name keychain, types MIA, picks blue -> See my price (no worker in e2e:
 *   the honest "workshop is offline", then the golden workshop output is planted by the seam and
 *   Try again prices it on the real print engine) -> Ask a grown-up -> Mia tries /checkout and
 *   /studio and is sent back to Kids mode -> exit with the PIN -> the grown-up approves & pays
 *   (dev payment) -> the order exists -> back in Kids mode, My things says it's being made.
 */
import { expect, test } from '@playwright/test';
import { payOrder } from './support/journeys';
import { KIDS_PIN, plantGoldenKidCad } from './support/kids';
import { videoOptions } from './support/video';

const VIEWPORTS = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const vp of VIEWPORTS) {
    test(`a kid designs, asks, and a grown-up approves and pays · ${vp.name}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...videoOptions(vp) });
        const page = await context.newPage();
        const email = `kids-${vp.name}-${Date.now().toString(36)}@example.com`;

        // ---- 1. The grown-up signs in with an email code ----
        await page.goto('/signin?next=/family');
        await page.getByTestId('signin-email').fill(email);
        await page.getByTestId('signin-email-submit').click();
        const devCode = (await page.getByTestId('signin-dev-code').locator('.font-mono').textContent())!.trim();
        await page.getByTestId('signin-code').fill(devCode);
        await page.getByTestId('signin-code-submit').click();
        await page.waitForURL(/\/family$/, { timeout: 30_000 });
        await expect(page.getByRole('heading', { level: 1, name: 'Family' })).toBeVisible();

        // ---- 2. PIN and a kid profile (nickname, age band, avatar: nothing else) ----
        await expect(page.getByTestId('family-pin-status')).toHaveText('Not set');
        await page.getByTestId('family-pin-input').fill(KIDS_PIN);
        await page.getByTestId('family-pin-save').click();
        await expect(page.getByTestId('family-pin-status')).toHaveText('Set');
        await page.getByTestId('kid-nickname').fill('Mia');
        await page.getByTestId('kid-age-10-12').click();
        await page.getByTestId('kid-avatar-owl').click();
        await page.getByTestId('kid-add').click();
        const card = page.getByTestId('kid-card-mia');
        await expect(card).toContainText('Age 10-12');
        await expect(card).toContainText('up to $25.00 a request');

        // ---- 3. Hand to Mia: Kids mode ----
        await card.getByRole('button', { name: 'Hand to Mia' }).click();
        await page.waitForURL(/\/kids$/);
        await expect(page.getByTestId('kid-hello')).toHaveText(/Hi, Mia/);
        await expect(page.getByTestId('kid-bottom-nav').getByRole('link')).toHaveCount(3);
        await expect(page.getByTestId('bottom-nav')).toHaveCount(0);

        // ---- 4. Mia designs a name keychain ----
        await page.getByTestId('kid-tile-name_keychain').click();
        await page.waitForURL(/\/kids\/make\/name_keychain$/);
        await expect(page.getByTestId('kid-step')).toHaveText('Step 1 of 4');
        await page.getByTestId('kid-label-input').fill('MIA!');
        await page.getByTestId('kid-next').click();
        await expect(page.getByTestId('kid-label-message')).toHaveText('Use letters, numbers and spaces only.');
        await page.getByTestId('kid-label-input').fill('MIA');
        await expect(page.getByTestId('kid-label-count')).toHaveText('3 of 12');
        await expect(page.getByTestId('kid-preview')).toContainText('MIA');
        await page.getByTestId('kid-next').click();
        await expect(page.getByTestId('kid-step')).toHaveText('Step 2 of 4');
        await page.getByTestId('kid-color-blue').click();
        await expect(page.getByTestId('kid-color-blue')).toHaveAttribute('aria-checked', 'true');
        await page.getByTestId('kid-next').click();
        await expect(page.getByTestId('kid-step')).toHaveText('Step 3 of 4');
        await expect(page.getByTestId('kid-size-small')).toHaveAttribute('aria-checked', 'true');
        const nextBox = (await page.getByTestId('kid-next').boundingBox())!;
        expect(nextBox.height).toBeGreaterThanOrEqual(48);
        await page.getByTestId('kid-next').click();

        // ---- 5. No workshop in e2e: honest offline state, then the seam, then the real price ----
        await expect(page.getByTestId('kid-step')).toHaveText('Step 4 of 4');
        await expect(page.getByTestId('kid-offline')).toContainText('The workshop is offline', { timeout: 30_000 });
        await expect(page.getByTestId('kid-price')).toHaveCount(0);
        await plantGoldenKidCad(email);
        await page.getByTestId('kid-try-again').click();
        await expect(page.getByTestId('kid-price')).toHaveText(/^This costs \$\d+\.\d{2}\. A grown-up needs to say yes\.$/, { timeout: 30_000 });
        const priceText = (await page.getByTestId('kid-price').textContent())!.match(/\$\d+\.\d{2}/)![0];
        await page.getByTestId('kid-ask').click();
        await expect(page.getByTestId('kid-asked')).toBeVisible();

        // ---- 6. Kid-forbidden routes send Mia back to Kids mode ----
        for (const forbidden of ['/checkout/qte_anything', '/studio', '/me', '/cart']) {
            await page.goto(forbidden);
            await expect(page).toHaveURL(/\/kids$/);
        }
        const api = await page.request.post('/api/checkout', { data: {} });
        expect(api.status()).toBe(403);

        await page.goto('/kids/things');
        await expect(page.getByTestId('kid-thing').first()).toHaveAttribute('data-stage', 'waiting');
        await expect(page.getByTestId('kid-thing-stage').first()).toHaveText('Waiting for a grown-up');

        // ---- 7. Exit with the grown-up PIN ----
        await page.getByTestId('kid-nav-exit').click();
        await page.waitForURL(/\/kids\/exit$/);
        await page.getByTestId('kid-pin-1').click();
        await page.getByTestId('kid-pin-1').click();
        await page.getByTestId('kid-pin-1').click();
        await page.getByTestId('kid-pin-1').click();
        await expect(page.getByTestId('kid-pin-error')).toContainText('not right');
        for (const d of KIDS_PIN) await page.getByTestId(`kid-pin-${d}`).click();
        await page.waitForURL(/\/family$/, { timeout: 30_000 });

        // ---- 8. The grown-up approves & pays through their normal checkout ----
        const request = page.getByTestId('family-request').first();
        await expect(request).toHaveAttribute('data-status', 'pending');
        await expect(request).toContainText('Mia asked');
        await expect(request).toContainText('“MIA” · blue · small');
        await expect(request.getByTestId('family-request-price')).toContainText(priceText);
        await request.getByTestId('family-approve').click();
        await page.waitForURL(/\/checkout\/qte_/);
        const { orderUrl } = await payOrder(page);
        expect(orderUrl).toMatch(/\/orders\/ord_/);

        await page.goto('/family');
        const done = page.getByTestId('family-request').first();
        await expect(done).toHaveAttribute('data-status', 'approved');
        await expect(done.getByTestId('family-request-stage')).toContainText(/being made · order DMO-/);
        await expect(page.getByTestId('family-activity')).toContainText('Approved Mia’s Name keychain');

        // ---- 9. Back in Kids mode: My things shows it's being made ----
        await page.getByTestId('kid-card-mia').getByRole('button', { name: 'Hand to Mia' }).click();
        await page.waitForURL(/\/kids$/);
        await page.getByTestId('kid-nav-things').click();
        await page.waitForURL(/\/kids\/things$/);
        await expect(page.getByTestId('kid-thing').first()).toHaveAttribute('data-stage', 'making');
        await expect(page.getByTestId('kid-thing-stage').first()).toHaveText('Yes! It’s being made');
        await context.close();
    });
}
