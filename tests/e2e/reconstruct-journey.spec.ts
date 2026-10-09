/**
 * Stage 5 G3 demo (R6 Reconstruct), at phone (390 px) and desktop (1280 px) width:
 *   a photo of a broken knob -> set the scale with the credit-card preset -> measure the
 *   diameter on the photo -> confirm two caliper readings -> Generate (no worker in e2e: the
 *   honest "CAD service unavailable", then the golden worker output is planted by the seam) ->
 *   BINDING print quote from the real print engine -> checkout (dev payment) -> the order
 *   exists and the partner shop sees a 3D-print job with the STL.
 */
import { expect, test, type Page } from '@playwright/test';
import { payOrder, shopLogin } from './support/journeys';
import { KNOB_PHOTO, KNOB_PHOTO_PX, plantGoldenKnobCad } from './support/reconstruct';

const VIEWPORTS = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 800 },
] as const;

/** Tap a point given in photo pixels on the measuring canvas. */
async function tapPhoto(page: Page, p: { x: number; y: number }) {
    const canvas = page.getByTestId('measure-canvas');
    // Centre the canvas so no tap lands under the sticky header.
    await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + (p.x / KNOB_PHOTO_PX.width) * box.width, box.y + (p.y / KNOB_PHOTO_PX.height) * box.height);
}

for (const vp of VIEWPORTS) {
    test(`broken knob photo to a printed replacement order · ${vp.name}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await context.newPage();

        // ---- 1. Capture ----
        await page.goto('/reconstruct');
        await expect(page.getByRole('heading', { level: 1, name: 'Rebuild a broken part from a photo' })).toBeVisible();
        await expect(page.getByTestId('capture-camera-input')).toHaveAttribute('capture', 'environment');
        await expect(page.getByTestId('capture-camera-input')).toHaveAttribute('accept', 'image/*');
        await page.getByTestId('part-type-knob').click();
        await page.getByTestId('capture-camera-input').setInputFiles(KNOB_PHOTO);
        await expect(page.getByTestId('capture-photo')).toHaveCount(1);
        await page.getByTestId('capture-description').fill('The stove knob cracked and fell off.');
        await page.getByTestId('capture-continue').click();
        await page.waitForURL(/\/reconstruct\/bld_[A-Za-z0-9_-]+\?step=measure$/, { timeout: 30_000 });
        const buildId = new URL(page.url()).pathname.split('/').pop()!;

        // ---- 2. Measure on the photo: credit-card scale, then the diameter ----
        await expect(page.getByTestId('measure-canvas')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('reference-preset')).toHaveValue('credit_card');
        await page.getByTestId('reference-mark').click();
        await tapPhoto(page, KNOB_PHOTO_PX.cardEdge[0]);
        await tapPhoto(page, KNOB_PHOTO_PX.cardEdge[1]);
        await expect(page.getByTestId('reference-scale')).toContainText('= 85.6 mm');
        await page.getByTestId('line-kind').selectOption('diameter');
        await page.getByTestId('line-add').click();
        await tapPhoto(page, KNOB_PHOTO_PX.knobDiameter[0]);
        await tapPhoto(page, KNOB_PHOTO_PX.knobDiameter[1]);
        await expect(page.getByTestId('line-param')).toHaveValue('diameter_mm');
        const estimate = Number(await page.getByTestId('line-estimate').inputValue());
        expect(Math.abs(estimate - 38.1), `photo estimate ${estimate} mm`).toBeLessThan(2);
        // Keyboard: nudge the end handle one pixel and back.
        await page.getByTestId(/handle-l.*-b/).first().focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await page.getByTestId('measure-continue').click();
        await page.waitForURL(/step=confirm$/);

        // ---- 3. Confirm two caliper readings (the knob's critical dimensions) ----
        await expect(page.getByRole('heading', { level: 1, name: 'Confirm with a caliper' })).toBeVisible();
        await expect(page.getByTestId('dim-estimate-diameter_mm')).toContainText('mm');
        await expect(page.getByTestId('generate-cad')).toBeDisabled();
        await expect(page.getByTestId('option-shaft')).toHaveValue('6mm-d');
        await page.getByTestId('option-ribs').fill('12');
        await page.getByTestId('option-ribs').blur();
        await page.getByTestId('option-notch').check();
        await expect(page.getByTestId('option-notch')).toBeChecked();
        await page.getByTestId('dim-unit-diameter_mm').selectOption('in');
        await page.getByTestId('dim-input-diameter_mm').fill('1.5');
        await page.getByTestId('dim-confirm-diameter_mm').click();
        await expect(page.getByTestId('dim-status-diameter_mm')).toContainText('Caliper confirmed');
        await expect(page.getByTestId('dim-caliper-diameter_mm')).toHaveText('38.10 mm');
        await page.getByTestId('dim-input-height_mm').fill('22');
        await page.getByTestId('dim-confirm-height_mm').click();
        await expect(page.getByTestId('dim-status-height_mm')).toContainText('Caliper confirmed');
        await expect(page.getByTestId('confirm-progress')).toHaveText('2 of 2 confirmed');

        // ---- 4. Generate: no CAD worker in e2e -> honest unavailable state ----
        await page.getByTestId('generate-cad').click();
        await expect(page.getByTestId('cad-unavailable')).toContainText('CAD service unavailable');
        // Seam: the worker's golden output for exactly the planned spec (checked inside).
        await plantGoldenKnobCad(context.request, buildId);

        // ---- 5. Review: Object View + BINDING print quote from the real engine ----
        await page.goto(`/reconstruct/${buildId}?step=review`);
        await expect(page.getByRole('heading', { level: 1, name: 'Review and order' })).toBeVisible();
        await expect(page.getByTestId('object-viewport')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('review-dimensions')).toContainText('38.10 mm');
        await expect(page.getByTestId('print-material-asa').getByRole('radio')).toBeChecked();
        await page.getByTestId('print-get-quote').click();
        await expect(page.getByTestId('print-quote').getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 20_000 });
        await expect(page.getByTestId('print-ladder').locator('tbody tr')).toHaveCount(5);
        await page.getByTestId('print-checkout').click();
        await page.waitForURL(/\/checkout\/qte_/);

        // ---- 6. Checkout (dev payment): the order exists ----
        const { orderUrl, orderNumber } = await payOrder(page);
        expect(orderUrl).toMatch(/\/orders\/ord_/);

        // ---- 7. The partner shop sees a 3D-print job with the STL ----
        const shop = await context.newPage();
        await shopLogin(shop);
        await shop.getByTestId('jobs-tab-offered').click();
        await shop.getByRole('link', { name: new RegExp(orderNumber) }).click();
        await shop.waitForURL(/\/shop\/jobs\/job_/);
        await expect(shop.getByTestId('packet-print')).toContainText('FDM');
        await expect(shop.getByText(/\.stl$/).first()).toBeVisible();
        await shop.getByTestId('job-accept').click();
        await shop.getByTestId('job-accept-confirm').click();
        await expect(shop.getByTestId('packet-file')).toContainText('.stl', { timeout: 15_000 });
        await context.close();
    });
}
