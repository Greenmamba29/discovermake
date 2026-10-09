/**
 * DiscoverMake Live acceptance journey (spec §9.10, workflow 06), through the real UI and APIs.
 *
 * Two browser contexts, both signed in for real (email code; `devCode` outside production).
 *
 *   creator: becomes a creator, sets up a channel -> schedule a show featuring two builds -> go live -> feature a product
 *   viewer:  enters, sees the product, asks the creator (host answers), asks Make AI,
 *            sees the card change in realtime when the host features another build,
 *            Make Mine opens the configure sheet without leaving the stream, Buy reaches checkout
 *   drop:    host starts a drop, viewer claims a Build Slot (counter updates for both),
 *            host closes the drop and the viewer's order is confirmed and dispatched
 */
import { expect, test } from '@playwright/test';
import { confirm, quotePart } from './support/journeys';
import { approvedGraphBuild, LIVE_CREATOR, LIVE_VIEWER, setUpShow, signedInContext } from './support/live';

test('a creator goes live, a viewer shops the stream and claims a Build Slot', async ({ browser }) => {
    test.setTimeout(240_000);
    const creator = await signedInContext(browser, LIVE_CREATOR);
    const host = await creator.newPage();

    // Two products: an uploaded part with an orderable BINDING quote, and an approved Make AI build.
    const quoted = await quotePart(host, 'live-lamp-plate.dxf');
    const part = await (await host.request.get(`/api/parts/${quoted.partId}`)).json();
    const productA: string = part.buildId;
    const productB = await approvedGraphBuild(host);

    const showId = await setUpShow(host, [productA, productB], 'Lamp build night');
    await confirm(host, 'start-show');
    await expect(host.getByTestId('control-room')).toHaveAttribute('data-status', 'LIVE');
    await host.getByTestId(`feature-${productA}`).click();
    await expect(host.getByTestId(`featured-${productA}`)).toContainText('Now showing');

    // Viewer enters and sees the featured product.
    const viewerCtx = await signedInContext(browser, LIVE_VIEWER, { width: 390, height: 844 });
    const viewer = await viewerCtx.newPage();
    await viewer.goto(`/live/${showId}`);
    await expect(viewer.getByTestId('live-badge')).toContainText(/live/i);
    await expect(viewer.getByTestId('now-showing')).toHaveAttribute('data-build-id', productA);
    await expect(viewer.getByTestId('now-showing-name')).toContainText('live-lamp-plate');
    await viewer.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));

    // Ask the creator; the host answers from the control room; the viewer sees the answer.
    await viewer.getByTestId('composer-mode-creator').click();
    await viewer.getByTestId('composer-input').fill('Can you do it in black?');
    await viewer.getByTestId('composer-send').click();
    const queued = host.locator('[data-testid^="queue-"]').filter({ hasText: 'Can you do it in black?' });
    await expect(queued).toBeVisible({ timeout: 15_000 });
    await queued.getByRole('textbox').fill('Yes, black powder coat is available.');
    await queued.getByRole('button', { name: 'Answer' }).click();
    await expect(viewer.locator('[data-mode="creator"]').filter({ hasText: 'Can you do it in black?' }).getByTestId('question-answer')).toContainText('black powder coat', { timeout: 15_000 });

    // Ask Make AI: answered at once from the build record (no model key in e2e).
    await viewer.getByTestId('composer-mode-make_ai').click();
    await viewer.getByTestId('composer-input').fill('What is it made of?');
    await viewer.getByTestId('composer-send').click();
    await expect(viewer.locator('[data-mode="make_ai"]').filter({ hasText: 'What is it made of?' }).getByTestId('question-answer')).toContainText(/6061/, { timeout: 15_000 });

    // Realtime product card: the host features the other build, the card follows without a reload.
    await host.getByTestId(`feature-${productB}`).click();
    await expect(viewer.getByTestId('now-showing')).toHaveAttribute('data-build-id', productB, { timeout: 15_000 });
    expect(await viewer.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

    // Make Mine clones the approved build and opens the configure sheet over the stream.
    await viewer.getByTestId('make-mine').click();
    await expect(viewer.getByTestId('configure-sheet')).toBeVisible();
    await expect(viewer.getByTestId('clone-ready')).toBeVisible({ timeout: 15_000 });
    expect(new URL(viewer.url()).pathname).toBe(`/live/${showId}`);
    await expect(viewer.getByTestId('video-stage')).toBeAttached();
    await viewer.getByTestId('configure-sheet').getByRole('button', { name: 'Close' }).click();

    // Back to product A; Buy reaches checkout with its binding quote.
    await host.getByTestId(`feature-${productA}`).click();
    await expect(viewer.getByTestId('now-showing')).toHaveAttribute('data-build-id', productA, { timeout: 15_000 });
    await expect(viewer.getByTestId('buy')).toHaveAttribute('href', /\/checkout\/qte_/);
    const checkout = await viewerCtx.newPage();
    await checkout.goto((await viewer.getByTestId('buy').getAttribute('href'))!);
    await expect(checkout.getByTestId('shipping-option-STANDARD')).toBeVisible();
    await checkout.close();

    // Host starts a drop (price above the binding unit price at the production quantity).
    await host.getByTestId('drop-price').fill('250');
    await host.getByTestId('drop-total').fill('5');
    await host.getByTestId('drop-threshold').fill('1');
    await host.getByTestId('drop-limit').fill('2');
    await host.getByTestId('drop-start').click();
    await expect(host.getByTestId('control-drop')).toHaveAttribute('data-status', 'OPEN', { timeout: 15_000 });
    await expect(viewer.getByTestId('slots-left')).toHaveText('5 / 5 slots left', { timeout: 15_000 });

    // Viewer claims a Build Slot and authorizes the hold; both counters update.
    await viewer.getByTestId('claim-slot').click();
    await viewer.getByTestId('claim-name').fill('Vic Viewer');
    await viewer.getByTestId('claim-line1').fill('1 Market St');
    await viewer.getByTestId('claim-city').fill('San Francisco');
    await viewer.getByTestId('claim-region').selectOption('CA');
    await viewer.getByTestId('claim-postal').fill('94105');
    await viewer.getByTestId('claim-terms').check();
    await viewer.getByTestId('claim-submit').click();
    await expect(viewer.getByTestId('claim-result')).toBeVisible({ timeout: 15_000 });
    await viewer.getByTestId('claim-authorize').click();
    await expect(viewer.getByTestId('claim-result')).toHaveAttribute('data-status', 'AUTHORIZED', { timeout: 15_000 });
    await viewer.getByTestId('claim-sheet').getByRole('button', { name: 'Close' }).click();
    await expect(viewer.getByTestId('slots-left')).toHaveText('4 / 5 slots left', { timeout: 15_000 });
    await expect(host.getByTestId('control-drop-count')).toContainText('1 / 5 claimed', { timeout: 15_000 });

    // Host closes the drop: the hold is captured and the order goes to production.
    await confirm(host, 'close-drop');
    await expect(host.getByTestId('control-drop')).toHaveAttribute('data-status', 'CONFIRMED', { timeout: 20_000 });
    await expect(viewer.getByTestId('slot-counter')).toHaveAttribute('data-status', 'CONFIRMED', { timeout: 15_000 });
    await expect(viewer.getByTestId('my-claim').first()).toHaveAttribute('data-status', 'CAPTURED', { timeout: 15_000 });
    const orderHref = await viewer.getByTestId('my-claim-order').first().getAttribute('href');
    const order = await viewerCtx.newPage();
    await order.goto(orderHref!);
    await expect(order.getByTestId('order-status')).toContainText(/waiting for the shop/i, { timeout: 30_000 });

    await viewerCtx.close();
    await creator.close();
});
