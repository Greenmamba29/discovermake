/**
 * Discover, Live and Creator tours: find a clip and make your own copy; shop a live stream
 * and claim a Build Slot (viewer on a phone, creator on desktop, recorded side by side);
 * publish, read Insights and get paid in Creator Studio.
 */
import { expect, test } from '@playwright/test';
import { quotePart } from '../e2e/support/journeys';
import { approvedGraphBuild, setUpShow } from '../e2e/support/live';
import { buildMediaSweepState, type MediaSweepState } from '../e2e/support/media';
import { DESKTOP, endTour, note, PHONE, point, say, scroll, shows, startTour, titleCard, type } from './support/narrate';

let media: MediaSweepState;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    media = await buildMediaSweepState(browser, quotePart);
});

test('05 · Discover, clips and Make Mine (phone)', async ({ browser }) => {
    const run = Date.now().toString(36);
    const t = await startTour(browser, '05-discover-clips-and-remix-phone', { viewport: PHONE, total: 8, signInAs: { email: `tour-viewer-${run}@example.com`, name: 'Sam Viewer' } });
    const { page } = t;
    await page.goto('/discover');
    await titleCard(t, 'Discover', 'Watch it made. Make it yours.', 'Browse builds, clips and shows from makers, and order your own copy in a few taps.');
    await say(t, 'Your Discover feed', 'Ranked builds, clips from live shows and upcoming streams, tuned to the interests you picked.');
    await point(t, page.getByTestId('feed-tab-new'));
    await page.waitForTimeout(1200);
    const clip = page.locator('[data-testid="feed-clip"]').filter({ hasText: 'Sweep lamp reveal' }).first();
    await shows(clip);
    await say(t, 'Clips cut from live shows', 'Short moments from a maker’s stream, with the product attached.');
    await point(t, clip.getByTestId('clip-open'));
    await page.waitForURL(/\/clips\/clp_/);
    await shows(page.getByTestId('clip-player'));
    await page.waitForTimeout(2500);
    await say(t, 'Shop the clip', 'The product chips stay pinned while it plays. Pause any time; Buy or Make Mine are always one tap away.', 3800);
    await point(t, page.getByTestId('clip-toggle'));
    await note(t, 'Make Mine', 'Make Mine copies the design into your own build. The original creator earns a royalty when you order.');
    await point(t, page.getByTestId('clip-make-mine'));
    await page.waitForURL(/\/parts\/prt_/, { timeout: 60_000 });
    await say(t, 'Your copy', 'Pick the material and thickness. The price is a binding quote, like any part you upload.');
    await point(t, page.getByTestId('material-option-mat_al_6061'));
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await point(t, thickness);
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
    await point(t, page.getByTestId('checkout-cta'), { click: false });
    await say(t, 'Order like any part', 'Checkout, tracking and the Product Passport work exactly as before.');

    await page.goto(media.buildUrl);
    await say(t, 'The build page', 'Every published build shows its creator, its remix licence and the remix family tree.');
    await scroll(t, 600);
    await page.goto(media.channelUrl);
    await say(t, 'Creator channels', 'Follow a maker to see their builds, clips and upcoming shows.');
    await scroll(t, 500);
    await page.goto(media.watchUrl);
    await say(t, 'Watch My Build', 'After you order, watch your own part being made: every production step appears on its own stream.', 4000);
    await endTour(t, { title: 'Discover anything', body: 'Watch, remix and order, all from your phone.' });
});

test('06–07 · Live shopping (viewer phone) and Going live (creator desktop)', async ({ browser }) => {
    const run = Date.now().toString(36);
    const host = await startTour(browser, '07-creator-going-live', { viewport: DESKTOP, total: 9, signInAs: { email: `tour-host-${run}@example.com`, name: 'Amanda Maker' } });
    const quoted = await quotePart(host.page, 'live-lamp-plate.dxf');
    const productA: string = (await (await host.page.request.get(`/api/parts/${quoted.partId}`)).json()).buildId;
    const productB = await approvedGraphBuild(host.page);

    await host.page.goto('/studio');
    await titleCard(host, 'Creators · Live', 'Go live and sell while you make', 'Set up a channel, schedule a show, feature products and run a drop.');
    await say(host, 'Creator Studio', 'The go-live checklist walks you through a channel, a show and the products to feature.');
    const showId = await setUpShow(host.page, [productA, productB], 'Lamp build night');
    await say(host, 'Your control room', 'Everything for a live show on one screen: go live, feature products, answer questions, run drops and polls.', 3800);
    await point(host, host.page.getByTestId('start-show'));
    await point(host, host.page.getByTestId('start-show-confirm'));
    await expect(host.page.getByTestId('control-room')).toHaveAttribute('data-status', 'LIVE');
    await point(host, host.page.getByTestId(`feature-${productA}`));
    await say(host, 'Feature a product', 'Viewers see the featured product card update instantly, without reloading.');

    const viewer = await startTour(browser, '06-live-shopping-phone', { viewport: PHONE, total: 8, signInAs: { email: `tour-live-viewer-${run}@example.com`, name: 'Vic Viewer' } });
    await viewer.page.goto(`/live/${showId}`);
    await titleCard(viewer, 'Live', 'Shop a live build', 'Watch a maker live, ask questions, and buy or claim a slot without leaving the stream.');
    await shows(viewer.page.getByTestId('now-showing'));
    await say(viewer, 'The live stream', 'The product card shows what the maker is featuring right now, with its price.');
    await viewer.page.getByTestId('composer-mode-creator').click();
    await type(viewer, viewer.page.getByTestId('composer-input'), 'Can you do it in black?');
    await point(viewer, viewer.page.getByTestId('composer-send'));
    await say(viewer, 'Ask the creator', 'Questions go to the creator’s queue. Answers appear right under your question.');

    const queued = host.page.locator('[data-testid^="queue-"]').filter({ hasText: 'Can you do it in black?' });
    await shows(queued);
    await say(host, 'Answer questions', 'Viewer questions queue up in the control room. Answer them live.');
    await type(host, queued.getByRole('textbox'), 'Yes, black powder coat is available.');
    await point(host, queued.getByRole('button', { name: 'Answer' }));
    await expect(viewer.page.locator('[data-mode="creator"]').filter({ hasText: 'Can you do it in black?' }).getByTestId('question-answer')).toContainText('black powder coat', { timeout: 20_000 });
    await note(viewer, 'Answered', 'The creator’s answer arrives in real time.');

    await viewer.page.getByTestId('composer-mode-make_ai').click();
    await type(viewer, viewer.page.getByTestId('composer-input'), 'What is it made of?');
    await point(viewer, viewer.page.getByTestId('composer-send'));
    await expect(viewer.page.locator('[data-mode="make_ai"]').filter({ hasText: 'What is it made of?' }).getByTestId('question-answer')).toContainText(/6061/, { timeout: 20_000 });
    await say(viewer, 'Ask Make AI', 'Make AI answers from the build record (materials, sizes, lead time) without bothering the host.');

    await point(host, host.page.getByTestId(`feature-${productB}`));
    await expect(viewer.page.getByTestId('now-showing')).toHaveAttribute('data-build-id', productB, { timeout: 20_000 });
    await say(viewer, 'Make Mine, mid-stream', 'Make Mine copies the featured design and opens the configurator over the stream, so you never leave the show.');
    await point(viewer, viewer.page.getByTestId('make-mine'));
    await shows(viewer.page.getByTestId('clone-ready'));
    await viewer.page.waitForTimeout(1500);
    await viewer.page.getByTestId('configure-sheet').getByRole('button', { name: 'Close' }).click();

    await point(host, host.page.getByTestId(`feature-${productA}`));
    await say(host, 'Start a drop', 'A drop sells a limited run of Build Slots at your price. It is confirmed only if enough slots are claimed.', 3800);
    await type(host, host.page.getByTestId('drop-price'), '250');
    await type(host, host.page.getByTestId('drop-total'), '5');
    await type(host, host.page.getByTestId('drop-threshold'), '1');
    await type(host, host.page.getByTestId('drop-limit'), '2');
    await point(host, host.page.getByTestId('drop-start'));
    await expect(host.page.getByTestId('control-drop')).toHaveAttribute('data-status', 'OPEN', { timeout: 20_000 });

    await expect(viewer.page.getByTestId('slots-left')).toHaveText('5 / 5 slots left', { timeout: 20_000 });
    await say(viewer, 'Claim a Build Slot', 'Your card is only authorized when you claim. It is charged only if the drop reaches its goal; otherwise the hold is released.', 4000);
    await point(viewer, viewer.page.getByTestId('claim-slot'));
    await type(viewer, viewer.page.getByTestId('claim-name'), 'Vic Viewer');
    await type(viewer, viewer.page.getByTestId('claim-line1'), '1 Market St');
    await type(viewer, viewer.page.getByTestId('claim-city'), 'San Francisco');
    await viewer.page.getByTestId('claim-region').selectOption('CA');
    await type(viewer, viewer.page.getByTestId('claim-postal'), '94105');
    await viewer.page.getByTestId('claim-terms').check();
    await point(viewer, viewer.page.getByTestId('claim-submit'));
    await shows(viewer.page.getByTestId('claim-result'));
    await point(viewer, viewer.page.getByTestId('claim-authorize'));
    await expect(viewer.page.getByTestId('claim-result')).toHaveAttribute('data-status', 'AUTHORIZED', { timeout: 20_000 });
    await viewer.page.getByTestId('claim-sheet').getByRole('button', { name: 'Close' }).click();
    await expect(viewer.page.getByTestId('slots-left')).toHaveText('4 / 5 slots left', { timeout: 20_000 });
    await note(viewer, 'Counters update live', 'Everyone watching sees the slots go.');

    await expect(host.page.getByTestId('control-drop-count')).toContainText('1 / 5 claimed', { timeout: 20_000 });
    await say(host, 'Close the drop', 'Goal reached: closing captures the authorized holds and sends every order to production.');
    await point(host, host.page.getByTestId('close-drop'));
    await point(host, host.page.getByTestId('close-drop-confirm'));
    await expect(host.page.getByTestId('control-drop')).toHaveAttribute('data-status', 'CONFIRMED', { timeout: 30_000 });
    await expect(viewer.page.getByTestId('my-claim').first()).toHaveAttribute('data-status', 'CAPTURED', { timeout: 20_000 });
    await say(viewer, 'Your slot is confirmed', 'The drop hit its goal: your order is placed and you can track it like any other.');
    await say(host, 'Live commerce, end to end', 'Every price and payment event in a show is signed, so a viewer can’t fake a sale.');
    await endTour(viewer, { title: 'Live shopping', body: 'Watch, ask, make it yours, or claim a slot.' });
    await endTour(host, { title: 'You went live', body: 'Next: publish builds, read Insights, get paid.' });
});

test('10 · Creator Studio: publish, Insights and payouts (desktop)', async ({ browser }) => {
    const t = await startTour(browser, '10-creator-publish-insights-payouts', { viewport: DESKTOP, total: 7, cookies: media.creatorCookies });
    const { page } = t;
    await page.goto('/studio/publish');
    await titleCard(t, 'Creators · Studio', 'Publish, grow and get paid', 'Share builds under a remix licence and earn royalties on every copy.');
    await say(t, 'Publishing', 'Choose what’s public, the remix licence (personal or commercial) and your royalty on remixes.', 3800);
    const row = page.locator('[data-testid="publish-row"]').first();
    await shows(row);
    await point(t, row, { click: false });
    await page.goto(media.buildUrl);
    await say(t, 'Your public build page', 'Shareable, with a licence chip and the remix family tree.');
    await page.goto('/studio/insights');
    await shows(page.getByTestId('insights'));
    await say(t, 'Insights', 'Views, orders, royalties and best sellers over any date range.', 3800);
    await scroll(t, 500);
    await page.goto('/studio/payouts');
    await shows(page.getByTestId('payouts-screen'));
    await say(t, 'Payouts', 'Royalties build up as an available balance. Request a payout. Production pays through Stripe Connect.', 3800);
    await point(t, page.getByTestId('earning-row').first(), { click: false });
    await say(t, 'Every earning, itemised', 'Each royalty links to the order that earned it. A refund reverses the earning automatically.');
    await page.goto(media.clipUrl);
    await say(t, 'Clips', 'Cut clips from your replays in the control room. They appear in Discover with your product attached.');
    await endTour(t, { title: 'Creator Studio', body: 'Publish, go live, and get paid when people make your designs.' });
});
