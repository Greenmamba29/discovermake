/**
 * Make AI "Make it in 3D" at phone (390 px) and desktop (1280 px) width:
 *   /make/ai shows the entry (honest unavailable state: no model key or CAD worker in e2e) ->
 *   the build's Object View offers Make it in 3D (unavailable too) -> the seam plants the golden
 *   cadgen output (generated now with the real worker venv from a fixed script) as a DRAFT ->
 *   Object View shows the model and its size -> the buyer approves the version -> BINDING
 *   3D-print quote from the real print engine -> checkout is reachable.
 */
import { expect, test } from '@playwright/test';
import { createTextToCadBuild, plantGoldenTextToCad } from './support/text-to-cad';
import { videoOptions } from './support/video';

const VIEWPORTS = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const vp of VIEWPORTS) {
    test(`describe it, check the 3D model, approve, binding print quote, checkout · ${vp.name}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...videoOptions(vp) });
        const page = await context.newPage();

        // ---- 1. /make/ai entry: honest unavailable state, nothing is created ----
        await page.goto('/make/ai');
        await expect(page.getByTestId('make3d-entry')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('make3d-entry').getByTestId('make3d-unavailable')).toContainText('not connected to a model yet');

        // ---- 2. The build's Object View offers Make it in 3D, honestly unavailable here ----
        const buildId = await createTextToCadBuild(context.request);
        await page.goto(`/build/${buildId}/workspace?section=object`);
        await expect(page.getByTestId('object-empty')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('make3d-panel').getByTestId('make3d-unavailable')).toContainText('Make AI');

        // Seam: the worker's golden cadgen output as the next DRAFT version (what makeIn3D stores).
        const version = await plantGoldenTextToCad(buildId);

        // ---- 3. Object View shows the model with its measured size ----
        await page.reload();
        await expect(page.getByTestId('object-viewport')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('object-model-label')).toHaveText('Made with Make AI');
        await expect(page.getByTestId('object-dim-X')).toHaveText('60.0 mm');
        await expect(page.getByTestId('object-dim-Y')).toHaveText('24.0 mm');
        await expect(page.getByTestId('object-dim-Z')).toHaveText('18.0 mm');
        await expect(page.getByTestId('object-download-STL')).toBeVisible();
        await expect(page.getByTestId('make3d-record')).toContainText('cadgen 0.7.20');

        // ---- 4. No quote before approval; the buyer approves the draft ----
        await expect(page.getByTestId('make3d-get-quote')).toHaveCount(0);
        await page.getByTestId('make3d-approve').click();

        // ---- 5. BINDING print quote from the real print engine ----
        await page.getByTestId('make3d-material-petg').click();
        await page.getByTestId('make3d-get-quote').click();
        await expect(page.getByTestId('make3d-quote').getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
        const status = await (await context.request.get(`/api/builds/${buildId}/text-to-cad`)).json();
        expect(status).toMatchObject({ latestVersion: version, latestApproved: true, quotable: true });
        expect(status.quoteId).toMatch(/^qte_/);

        // ---- 6. Checkout is reachable ----
        await page.getByTestId('make3d-checkout').click();
        await page.waitForURL(/\/checkout\/qte_/);
        await expect(page.getByTestId('pay-cta')).toBeVisible({ timeout: 30_000 });
        await context.close();
    });
}
