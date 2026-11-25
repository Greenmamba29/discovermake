/**
 * "Make it in 3D" with SolidCraft at phone (390 px) and desktop (1280 px) width:
 *   the seam plants the golden SolidCraft build (recorded from the real engine) as a DRAFT ->
 *   Object View shows the model and its measured size; the panel names the engine ->
 *   "Change sizes" lists every named size; typing a new value shows old -> new before anything
 *   is sent; an invalid value is refused in plain words -> with no CAD worker in e2e, submitting
 *   gives the honest unavailable reason and keeps the version -> the buyer approves the draft ->
 *   BINDING 3D-print quote from the real print engine -> checkout is reachable.
 * The rebuild itself (saved design + new values -> new DRAFT version) is covered against the real
 * engine in services/cad-worker/tests/test_solidcraft.py and with its goldens in
 * tests/text-to-cad/solidcraft.test.ts.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createTextToCadBuild, plantGoldenSolidcraft } from './support/text-to-cad';
import { videoOptions } from './support/video';

const VIEWPORTS = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 800 },
] as const;
const SHOTS = process.env.E2E_SHOTS_DIR;

for (const vp of VIEWPORTS) {
    test(`SolidCraft model: change sizes, approve, binding print quote, checkout · ${vp.name}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...videoOptions(vp) });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const shot = async (name: string) => {
            if (!SHOTS) return;
            mkdirSync(SHOTS, { recursive: true });
            await page.screenshot({ path: `${SHOTS}/${vp.name}-${name}.png`, fullPage: true });
        };

        const buildId = await createTextToCadBuild(context.request);
        const version = await plantGoldenSolidcraft(buildId);

        // ---- 1. The model, its measured size, and the engine that built it ----
        await page.goto(`/build/${buildId}/workspace?section=object`);
        await expect(page.getByTestId('object-viewport')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('object-dim-X')).toHaveText('60.0 mm');
        await expect(page.getByTestId('object-dim-Y')).toHaveText('24.0 mm');
        await expect(page.getByTestId('object-dim-Z')).toHaveText('18.0 mm');
        await expect(page.getByTestId('make3d-record')).toContainText('SolidCraft 0.48.1');

        // ---- 2. Change sizes: one field per named size, changes listed before sending ----
        const sizes = page.getByTestId('make3d-sizes');
        await expect(sizes).toBeVisible();
        for (const [name, value] of [['L', '60 mm'], ['W', '24 mm'], ['H', '18 mm'], ['slot', '5 mm'], ['pitch', '16 mm']] as const) {
            await expect(page.getByTestId(`make3d-size-${name}`)).toHaveValue(value);
        }
        await expect(sizes.getByLabel('Overall length')).toBeVisible();
        await expect(page.getByTestId('make3d-sizes-submit')).toBeDisabled();
        await page.getByTestId('make3d-size-L').fill('80 mm');
        await expect(page.getByTestId('make3d-size-changes')).toContainText('Overall length');
        await expect(page.getByTestId('make3d-size-changes')).toContainText('80 mm');
        await expect(page.getByTestId('make3d-sizes-submit')).toHaveText(`Make version ${version + 1}`);
        await sizes.scrollIntoViewIfNeeded();
        await shot('change-sizes');

        // An invalid value is refused in plain words and blocks the button.
        await page.getByTestId('make3d-size-slot').fill('5mm"; x');
        await page.getByTestId('make3d-size-slot').blur();
        await expect(sizes.getByRole('alert')).toContainText('Use a number with its unit');
        await expect(page.getByTestId('make3d-sizes-submit')).toBeDisabled();
        await page.getByTestId('make3d-size-slot').fill('5 mm');

        // ---- 3. No CAD worker in e2e: the honest reason, and the version is unchanged ----
        await page.getByTestId('make3d-sizes-submit').click();
        await expect(page.getByTestId('make3d-sizes-error')).toContainText('not set up here yet', { timeout: 30_000 });
        const before = await (await context.request.get(`/api/builds/${buildId}/text-to-cad`)).json();
        expect(before).toMatchObject({ latestVersion: version });

        // ---- 4. Approve the draft; BINDING print quote from the real print engine ----
        await page.getByTestId('make3d-sizes-reset').click();
        await page.getByTestId('make3d-approve').click();
        await page.getByTestId('make3d-material-petg').click();
        await page.getByTestId('make3d-get-quote').click();
        await expect(page.getByTestId('make3d-quote').getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
        await page.getByTestId('make3d-quote').scrollIntoViewIfNeeded();
        await shot('binding-quote');
        const status = await (await context.request.get(`/api/builds/${buildId}/text-to-cad`)).json();
        expect(status).toMatchObject({ latestVersion: version, latestApproved: true, quotable: true, record: { engine: { name: 'solidcraft' } } });

        // ---- 5. Checkout is reachable ----
        await page.getByTestId('make3d-checkout').click();
        await page.waitForURL(/\/checkout\/qte_/);
        await expect(page.getByTestId('pay-cta')).toBeVisible({ timeout: 30_000 });
        expect(errors).toEqual([]);
        await context.close();
    });
}
