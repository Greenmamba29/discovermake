/**
 * Prime, Reconstruct and partner tours: a Prime trial with a build cart, live tracking, chat and
 * a rating; rebuilding a broken part from a photo; the partner Shop Console from offer to
 * shipment and the buyer's Product Passport; the operations board.
 */
import { expect, test } from '@playwright/test';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';
import { E2E_ADMIN_TOKEN, E2E_SHOP_TOKEN } from '../../playwright.config';
import { adminLogin, fulfil, payOrder, quotePart, shopLogin } from '../e2e/support/journeys';
import { KNOB_PHOTO, KNOB_PHOTO_PX, plantGoldenKnobCad } from '../e2e/support/reconstruct';
import { DESKTOP, endTour, note, PHONE, point, say, scroll, shows, startTour, titleCard, type, type Tour } from './support/narrate';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function configure(t: Tour, name: string, quantity: number, narrate: boolean) {
    const { page } = t;
    await page.goto('/make');
    await page.getByTestId('upload-input').setInputFiles({ name, mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 60_000 });
    await point(t, page.getByTestId('material-option-mat_al_6061'), { pause: narrate ? 450 : 100 });
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
    await point(t, page.getByRole('button', { name: `Set quantity to ${quantity}`, exact: true }), { pause: narrate ? 450 : 100 });
    await expect(page.getByTestId('complete-your-build')).toBeVisible({ timeout: 20_000 });
}

test('08 · Prime, the build cart and live tracking (phone)', async ({ browser }) => {
    const email = `tour-prime-${Date.now().toString(36)}@example.com`;
    const t = await startTour(browser, '08-prime-cart-and-tracking-phone', { viewport: PHONE, total: 10, signInAs: { email, name: 'Priya Prime' } });
    const { page, context } = t;
    await page.goto('/prime');
    await titleCard(t, 'Prime', 'Free shipping, guaranteed dates', 'Try Prime free, order several parts in one cart, and follow them to your door.');
    await shows(page.getByRole('heading', { level: 1, name: 'Claim your free trial' }));
    await say(t, 'A clear free trial', 'The timeline shows exactly when you’d be charged. Cancel in one tap, any time.', 3800);
    await point(t, page.getByTestId('plan-monthly'));
    await point(t, page.getByTestId('prime-start-trial'));
    await page.waitForURL(/\/me\/membership\?welcome=1/);
    await say(t, 'You’re a member', 'Your membership page shows the plan, the trial end date and your benefits.');

    await configure(t, 'prime-a.dxf', 25, true);
    await say(t, 'Add parts to your build cart', 'Collect several parts and pay once.');
    await point(t, page.getByTestId('add-to-cart'));
    await expect(page.getByTestId('add-to-cart')).toContainText('In your build cart');

    await configure(t, 'prime-b.dxf', 10, false);
    const kit = page.getByTestId('upsell-hardware_kit');
    await shows(kit);
    await say(t, 'Complete your build', 'Suggested extras, such as a hardware kit, are priced by the same quote engine. No made-up prices.');
    await point(t, page.getByTestId('upsell-hardware_kit-add'));
    await expect(page.getByTestId('upsell-hardware_kit-add')).toContainText('Added');

    await page.goto('/make');
    await point(t, page.getByTestId('cart-pill'));
    await page.waitForURL(/\/cart$/);
    await say(t, 'One cart, one payment', 'Both parts, one checkout. Prime makes shipping free.');
    await type(t, page.getByTestId('cart-name'), 'Priya Prime');
    await type(t, page.getByTestId('cart-line1'), '1 Market St');
    await type(t, page.getByTestId('cart-city'), 'San Francisco');
    await page.getByTestId('cart-region').selectOption('CA');
    await type(t, page.getByTestId('cart-postal'), '94105');
    await expect(page.getByTestId('cart-shipping-total')).toHaveText('Free', { timeout: 20_000 });
    await point(t, page.getByTestId('cart-shipping-total'), { click: false });
    await page.getByTestId('cart-terms').check();
    await point(t, page.getByTestId('cart-checkout-cta'));
    await page.waitForURL(/\/checkout\/dev-pay\?ref=/, { timeout: 60_000 });
    await point(t, page.getByTestId('dev-pay-button'));
    await page.waitForURL(/\/cart\/done\/cco_[A-Za-z0-9_-]+\?t=/, { timeout: 60_000 });
    await say(t, 'Paid: one order per part', 'Each part goes to the best partner shop for it, with its own tracking link.');
    const first = page.locator('[data-testid^="cart-done-order-"]').first();
    const orderNumber = (await first.getAttribute('data-testid'))!.replace('cart-done-order-', '');
    const orderUrl = (await first.getAttribute('href'))!;

    // The shop makes and ships it; ops marks it delivered (separate windows, not in this video).
    const { jobUrl } = await fulfil(context, orderNumber, orderUrl);

    await page.goto(orderUrl);
    await shows(page.getByTestId('tracking-map'));
    await say(t, 'Live tracking', 'A map, the carrier and tracking number, and one plain status sentence.', 3800);
    await scroll(t, 400);
    await point(t, page.getByTestId('quick-reply-where_is_my_order'));
    await say(t, 'Chat with the shop', 'Quick replies such as "Where is my order?" go straight to the shop making your part.');
    const shop = await context.newPage();
    await shop.goto(jobUrl);
    if (shop.url().endsWith('/shop')) await shopLogin(shop).then(() => shop.goto(jobUrl));
    await shop.getByTestId('chat-input').fill('Delivered yesterday, enjoy!');
    await shop.getByTestId('chat-send').click();
    await shop.close();
    await expect(page.getByTestId('chat-message-shop')).toContainText('Delivered yesterday', { timeout: 20_000 });
    await note(t, 'The shop replied', 'Replies arrive here and by email.');

    await say(t, 'Rate it and show what you made', 'Stars, tags, a caption and a photo. Ratings are reviewed before they’re published.');
    await point(t, page.getByTestId('rating-star-5'));
    await point(t, page.getByTestId('rating-tag-quality'));
    await type(t, page.getByTestId('rating-caption'), 'Mounted on my robot arm');
    await page.getByTestId('rating-photo-input').setInputFiles({ name: 'made.png', mimeType: 'image/png', buffer: PNG });
    await shows(page.getByTestId('rating-photo-ready'));
    await point(t, page.getByTestId('rating-submit'));
    await expect(page.getByTestId('rating-status')).toContainText('in review');
    await page.waitForTimeout(1500);
    await endTour(t, { title: 'Prime', body: 'Free shipping, one cart, live tracking and a direct line to the shop.' });
});

test('09 · Reconstruct a broken part from a photo (phone)', async ({ browser }) => {
    const t = await startTour(browser, '09-reconstruct-broken-part-phone', { viewport: PHONE, total: 9 });
    const { page, context } = t;
    const tapPhoto = async (p: { x: number; y: number }) => {
        const canvas = page.getByTestId('measure-canvas');
        await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const box = (await canvas.boundingBox())!;
        const x = box.x + (p.x / KNOB_PHOTO_PX.width) * box.width;
        const y = box.y + (p.y / KNOB_PHOTO_PX.height) * box.height;
        await page.mouse.move(x, y, { steps: 10 });
        await page.waitForTimeout(300);
        await page.mouse.click(x, y);
    };
    await page.goto('/reconstruct');
    await titleCard(t, 'Reconstruct', 'Rebuild a broken part', 'Photograph it, measure it, confirm with a caliper, and order a printed replacement.');
    await shows(page.getByRole('heading', { level: 1, name: 'Rebuild a broken part from a photo' }));
    await say(t, 'What broke?', 'Pick the kind of part, then take a photo with a credit card next to it for scale.');
    await point(t, page.getByTestId('part-type-knob'));
    await page.getByTestId('capture-camera-input').setInputFiles(KNOB_PHOTO);
    await shows(page.getByTestId('capture-photo'));
    await type(t, page.getByTestId('capture-description'), 'The stove knob cracked and fell off.');
    await point(t, page.getByTestId('capture-continue'));
    await page.waitForURL(/\/reconstruct\/bld_[A-Za-z0-9_-]+\?step=measure$/, { timeout: 60_000 });
    const buildId = new URL(page.url()).pathname.split('/').pop()!;

    await shows(page.getByTestId('measure-canvas'));
    await say(t, 'Set the scale', 'Tap both ends of the card’s long edge. A credit card is exactly 85.6 mm, so the photo now has a scale.', 3800);
    await point(t, page.getByTestId('reference-mark'));
    await tapPhoto(KNOB_PHOTO_PX.cardEdge[0]);
    await tapPhoto(KNOB_PHOTO_PX.cardEdge[1]);
    await expect(page.getByTestId('reference-scale')).toContainText('= 85.6 mm');
    await say(t, 'Measure on the photo', 'Add a diameter line across the knob. The estimate is shown in millimetres.');
    await page.getByTestId('line-kind').selectOption('diameter');
    await point(t, page.getByTestId('line-add'));
    await tapPhoto(KNOB_PHOTO_PX.knobDiameter[0]);
    await tapPhoto(KNOB_PHOTO_PX.knobDiameter[1]);
    await page.waitForTimeout(1200);
    await point(t, page.getByTestId('measure-continue'));
    await page.waitForURL(/step=confirm$/);

    await shows(page.getByRole('heading', { level: 1, name: 'Confirm with a caliper' }));
    await say(t, 'Confirm with a caliper', 'Photo estimates are never trusted for fit. Every critical dimension needs a real caliper reading before CAD runs.', 4200);
    await page.getByTestId('option-ribs').fill('12');
    await page.getByTestId('option-ribs').blur();
    await page.getByTestId('option-notch').check();
    await page.getByTestId('dim-unit-diameter_mm').selectOption('in');
    await type(t, page.getByTestId('dim-input-diameter_mm'), '1.5');
    await point(t, page.getByTestId('dim-confirm-diameter_mm'));
    await expect(page.getByTestId('dim-caliper-diameter_mm')).toHaveText('38.10 mm');
    await note(t, 'Inches or millimetres', '1.5 in is stored as exactly 38.10 mm.');
    await type(t, page.getByTestId('dim-input-height_mm'), '22');
    await point(t, page.getByTestId('dim-confirm-height_mm'));
    await expect(page.getByTestId('confirm-progress')).toHaveText('2 of 2 confirmed');
    await say(t, 'Generate the CAD', 'With every dimension confirmed, the CAD worker builds the replacement from a printable template.');
    await point(t, page.getByTestId('generate-cad'));
    await shows(page.getByTestId('cad-unavailable'));
    await note(t, 'Demo note', 'This demo has no CAD worker, so the app says so honestly. Its real output is loaded next.');
    await plantGoldenKnobCad(context.request, buildId);

    await page.goto(`/reconstruct/${buildId}?step=review`);
    await shows(page.getByRole('heading', { level: 1, name: 'Review and order' }));
    await shows(page.getByTestId('object-viewport'));
    await say(t, 'Review in 3D', 'Check the model and the confirmed dimensions before you order.', 3800);
    await point(t, page.getByTestId('print-get-quote'));
    await expect(page.getByTestId('print-quote').getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
    await say(t, 'A binding 3D-print quote', 'Priced by the print engine with a quantity ladder, then checkout as usual.');
    await point(t, page.getByTestId('print-checkout'));
    await page.waitForURL(/\/checkout\/qte_/);
    await page.waitForTimeout(1500);
    await endTour(t, { title: 'Reconstruct', body: 'From a broken part to a printed replacement, measured for real.' });
});

test('11 · Partner Shop Console: offer to shipment, and the Product Passport (desktop)', async ({ browser }) => {
    const t = await startTour(browser, '11-partner-shop-console', { viewport: DESKTOP, total: 9 });
    const { page, context } = t;
    // A buyer's paid order (separate window, not in this video).
    const buyer = await context.newPage();
    await quotePart(buyer, 'bracket-for-shop.dxf');
    const { orderUrl, orderNumber } = await payOrder(buyer);
    await buyer.close();

    await page.goto('/shop');
    await titleCard(t, 'Partner shops', 'The Shop Console', 'Accept jobs, record production, pass inspection and ship. Payouts follow delivery.');
    await say(t, 'Sign in with your shop token', 'Each partner shop has its own console token from onboarding.');
    await type(t, page.getByTestId('shop-token-input'), E2E_SHOP_TOKEN);
    await point(t, page.getByTestId('shop-login-submit'));
    await page.waitForURL(/\/shop\/jobs$/);
    await say(t, 'Job offers', 'Paid orders arrive as offers matched to your machines and materials. They expire if not accepted.');
    await point(t, page.getByTestId('jobs-tab-offered'));
    await point(t, page.getByRole('link', { name: new RegExp(orderNumber) }));
    await page.waitForURL(/\/shop\/jobs\/job_/);
    await say(t, 'The job packet', 'Drawings, material, quantity, ship date and your payout, signed so you know it’s genuine.', 3800);
    await point(t, page.getByTestId('job-accept'));
    await point(t, page.getByTestId('job-accept-confirm'));
    await expect(page.getByTestId('job-status-text')).toContainText('Accepted', { timeout: 20_000 });
    await say(t, 'Record each step', 'Tap a milestone as you go. The buyer sees each one on their tracking page and Watch My Build.');
    for (const kind of ['MATERIAL_STAGED', 'CUTTING', 'QA'] as const) {
        await point(t, page.getByTestId(`milestone-${kind}`));
        await point(t, page.getByTestId(`milestone-${kind}-confirm`));
        await expect(page.getByTestId(`milestone-${kind}`)).toHaveCount(0, { timeout: 20_000 });
    }
    await shows(page.getByTestId('qa-form'));
    await say(t, 'Inspection before shipping', 'Measure the key dimensions and attach a photo. A failed inspection opens a rework job instead of shipping.', 4000);
    const checks = page.locator('[data-testid^="qa-check-"]');
    for (let i = 0; i < (await checks.count()); i++) {
        const check = checks.nth(i);
        const measure = check.locator('[data-testid^="qa-measure-"]');
        if (await measure.count()) {
            const nominal = (await check.textContent())?.match(/nominal (-?[\d.]+)/)?.[1];
            await type(t, measure, nominal ?? '0');
        } else {
            await point(t, check.locator('[data-testid^="qa-pass-"]'));
        }
    }
    await page.getByTestId('qa-photo-input').setInputFiles({ name: 'inspection.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('qa-photo').first()).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await type(t, page.getByTestId('qa-inspector'), 'Jordan Lee');
    await point(t, page.getByTestId('qa-submit'));
    await point(t, page.getByTestId('qa-submit-confirm'));
    await expect(page.getByTestId('job-status-text')).toContainText('Passed inspection', { timeout: 20_000 });
    await say(t, 'Ship it', 'Buy a label in the console, or enter your own carrier and tracking number.');
    await point(t, page.getByTestId('ship-mode-manual'));
    await type(t, page.getByTestId('ship-carrier'), 'UPS');
    await type(t, page.getByTestId('ship-service'), 'Ground');
    await type(t, page.getByTestId('ship-tracking'), '1Z999AA10123456785');
    await point(t, page.getByTestId('ship-submit'));
    await point(t, page.getByTestId('ship-submit-confirm'));
    await shows(page.getByTestId('shipment-card'));
    await page.goto('/shop/payouts');
    await say(t, 'Payouts', 'Your payout is recorded in the double-entry ledger when the part is delivered, and paid through Stripe Connect.');

    // Ops marks it delivered (separate window), then the buyer's view.
    const ops = await context.newPage();
    await adminLogin(ops);
    await ops.getByTestId(`admin-order-${orderNumber}`).click();
    await ops.getByTestId('admin-mark-delivered').click();
    await ops.getByTestId('admin-mark-delivered-confirm').click();
    await expect(ops.getByText(`${orderNumber} marked delivered.`)).toBeVisible({ timeout: 20_000 });
    await ops.close();
    await expect(async () => {
        await page.goto(orderUrl);
        await expect(page.getByTestId('order-status')).toContainText(/complete|delivered/i, { timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
    await say(t, 'What the buyer sees: delivered', 'Every milestone, the inspection and the shipment, on one page.');
    await point(t, page.getByTestId('passport-card'));
    await page.waitForURL(/\/passport\/pps_/);
    await say(t, 'The Product Passport', 'A signed, publicly verifiable record of how the part was made and inspected, with a QR code. Reorder a replacement from here.', 4500);
    await scroll(t, 500);
    await endTour(t, { title: 'Made, inspected, delivered', body: 'Every delivered part gets a passport.' });
});

test('12 · Operations board (desktop)', async ({ browser }) => {
    const t = await startTour(browser, '12-operations-board', { viewport: DESKTOP, total: 5 });
    const { page } = t;
    await page.goto('/admin');
    await titleCard(t, 'Operations', 'Run the marketplace', 'Orders that need attention, sourcing, moderation and invoices.');
    await say(t, 'Ops sign-in', 'Operators sign in with their ops account (or the admin token in this demo). Nothing here is public.');
    await type(t, page.getByTestId('admin-token-input'), E2E_ADMIN_TOKEN);
    await point(t, page.getByTestId('admin-login-submit'));
    await shows(page.getByTestId('ops-sourcing-link'));
    await say(t, 'The ops board', 'Orders filtered by what needs attention: unmatched, failed QA, late. Open any order to act on it.', 4000);
    await scroll(t, 400);
    await point(t, page.getByTestId('ops-sourcing-link'));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await say(t, 'The sourcing desk', 'Supplier requests, offers and approvals for parts no partner shop can make. Nothing is bought without an approval.');
    await page.goto('/admin/prime');
    await page.waitForTimeout(1500);
    await say(t, 'Moderation and invoices', 'Approve ratings, handle hold requests, read order chats and track B2B invoices.');
    await endTour(t, { title: 'Operations', body: 'Every money and safety decision has a human in the loop.' });
});
