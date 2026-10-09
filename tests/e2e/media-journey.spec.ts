/**
 * Stage 4 G3 demo (workflow 14): "a replay clip sells a remix whose royalty is paid to its
 * creator; the buyer's own build stream shows every milestone". Real UI and APIs, no mocks.
 *
 *   creator (desktop 1280): quotes a part, publishes it with a 10% commercial licence, runs a
 *            show that ends with a replay, cuts a clip from it in the control room
 *   viewer  (phone 390):    finds the clip in Discover, taps Make Mine, configures and orders
 *            the copy with the dev payment double
 *   creator:                sees the royalty in Insights and the balance, pays it out (ops mark it paid)
 *   shop + viewer:          the shop works the job; the buyer's Watch My Build shows each milestone
 *
 * Plus a live auction with two bidders and the anti-snipe extension.
 */
import { expect, test, type BrowserContextOptions } from '@playwright/test';
import { confirm, quotePart, shopLogin } from './support/journeys';
import { RUN, signedInContext } from './support/live';
import { adminHeaders, configureToCheckout, payAs, publishViaStudio, showWithReplay } from './support/media';

/**
 * The journeys also run on the mobile projects against the same database, so every account,
 * handle and clip title carries the project: a second run never sees the first run's rows.
 */
function runTag(): string {
    const project = test.info().project.name;
    return project === 'chromium' ? RUN : `${RUN}${project.replace(/[^a-z0-9]/g, '').slice(-3)}`;
}

/** Phone contexts: the project's device profile (touch, mobile UA) on mobile projects, else 390 px. */
function phone(): BrowserContextOptions {
    const use = test.info().project.use;
    if (!use.isMobile) return { viewport: { width: 390, height: 844 } };
    return { viewport: use.viewport, userAgent: use.userAgent, deviceScaleFactor: use.deviceScaleFactor, isMobile: true, hasTouch: use.hasTouch };
}

test('a replay clip sells a remix, the royalty reaches the creator and is paid out, the buyer watches the build', async ({ browser }) => {
    test.setTimeout(300_000);
    const tag = runTag();
    const CREATOR = { email: `media-creator-${tag}@example.com`, name: 'Amanda Maker' };
    const VIEWER = { email: `media-viewer-${tag}@example.com`, name: 'Vic Viewer' };
    const clipTitle = `Lamp plate reveal ${tag}`;
    const creatorCtx = await signedInContext(browser, CREATOR, { width: 1280, height: 800 });
    const creator = await creatorCtx.newPage();
    const handle = `amanda_m_${tag}`.slice(0, 24);
    expect((await creatorCtx.request.patch('/api/me', { data: { becomeCreator: true, handle } })).ok()).toBe(true);

    // 1. A build with a binding quote, published with a 10% commercial remix licence.
    const quoted = await quotePart(creator, 'media-lamp-plate.dxf');
    const buildId: string = (await (await creatorCtx.request.get(`/api/parts/${quoted.partId}`)).json()).buildId;
    await publishViaStudio(creator, buildId, { title: 'Walnut lamp plate', royaltyPct: 10, tags: 'lighting, desk-setup' });
    await creator.goto(`/b/${buildId}`);
    await expect(creator.getByTestId('public-build-title')).toHaveText('Walnut lamp plate');
    await expect(creator.getByTestId('license-chip')).toContainText('Commercial remix · 10% royalty');
    await expect(creator.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Walnut lamp plate');

    // 2. A show that ends with a replay; the creator cuts a clip from it in the control room.
    const showId = await showWithReplay(creatorCtx.request, { handle, buildId, title: 'Lamp build night' });
    await creator.goto(`/studio/shows/${showId}`);
    await expect(creator.getByTestId('control-room')).toHaveAttribute('data-status', 'ENDED');
    const suggestion = creator.getByTestId('clip-suggestion').first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.getByTestId('clip-suggestion-title').fill(clipTitle);
    await suggestion.getByTestId('clip-create').click();
    await expect(creator.getByTestId('published-clip').filter({ hasText: clipTitle })).toBeVisible({ timeout: 15_000 });

    // 3. A viewer on a phone finds the clip in Discover and taps Make Mine.
    const viewerCtx = await signedInContext(browser, VIEWER, undefined, phone());
    const viewer = await viewerCtx.newPage();
    await viewer.goto('/discover');
    await viewer.getByTestId('feed-tab-new').click();
    const clipCard = viewer.locator('[data-testid="feed-clip"]').filter({ hasText: clipTitle });
    await expect(clipCard).toBeVisible({ timeout: 15_000 });
    await clipCard.getByTestId('clip-open').click();
    await viewer.waitForURL(/\/clips\/clp_/);
    await expect(viewer.getByTestId('clip-player')).toBeVisible();
    await expect(viewer.getByTestId('clip-product')).toHaveAttribute('data-build-id', buildId);
    await viewer.getByTestId('clip-toggle').click(); // pause: the product chips stay pinned
    await viewer.getByTestId('clip-make-mine').click();
    await viewer.waitForURL(/\/parts\/prt_/, { timeout: 30_000 });
    expect(viewer.url()).not.toContain(quoted.partId);

    // 4. The viewer configures and orders their copy (dev payment).
    await configureToCheckout(viewer);
    const { orderUrl, orderNumber } = await payAs(viewer, VIEWER.email, VIEWER.name);

    // 5. The royalty shows in the creator's Insights and balance; the creator pays it out.
    await creator.goto('/studio/insights');
    await expect(creator.getByTestId('tile-royalties')).not.toContainText('$0.00', { timeout: 15_000 });
    await expect(creator.getByTestId('tile-orders')).toContainText('1');
    await expect(creator.getByTestId('best-seller-row').first()).toHaveAttribute('data-build-id', buildId);
    await expect(creator.getByTestId('earnings-chart')).toBeVisible();
    await creator.getByTestId('studio-nav-payouts').click();
    await creator.waitForURL(/\/studio\/payouts/);
    await expect(creator.getByTestId('earning-row').first()).toHaveAttribute('data-kind', 'MAKE_THIS_ROYALTY');
    const owed = Number(await creator.getByTestId('balance-available').getAttribute('data-cents'));
    expect(owed).toBeGreaterThan(0);
    await creator.getByTestId('request-payout').click();
    await expect(creator.getByTestId('payout-message')).toContainText('requested', { timeout: 15_000 });
    await expect(creator.getByTestId('payout-row').first()).toHaveAttribute('data-status', 'PENDING');
    // Dev mode has no Stripe: ops settle the manual payout.
    const pending = await (await creatorCtx.request.get('/api/admin/creator-payouts', { headers: adminHeaders() })).json();
    const payout = pending.payouts.find((p: { amountCents: number; status: string }) => p.amountCents === owed && p.status === 'PENDING');
    expect(payout).toBeTruthy();
    const paid = await creatorCtx.request.post(`/api/admin/creator-payouts/${payout.id}/paid`, { headers: adminHeaders(), data: { reference: `ACH-${tag}` } });
    expect(paid.ok(), await paid.text()).toBe(true);
    await creator.reload();
    await expect(creator.getByTestId('payout-row').first()).toHaveAttribute('data-status', 'PAID');
    await expect(creator.getByTestId('balance-available')).toHaveAttribute('data-cents', '0');

    // 6. The shop works the job; the buyer watches every milestone on Watch My Build.
    const shopPage = await viewerCtx.browser()!.newContext().then((c) => c.newPage());
    await shopLogin(shopPage);
    await shopPage.getByTestId('jobs-tab-offered').click();
    await shopPage.getByRole('link', { name: new RegExp(orderNumber) }).click();
    await shopPage.waitForURL(/\/shop\/jobs\/job_/);
    await confirm(shopPage, 'job-accept');
    await expect(shopPage.getByTestId('job-status-text')).toContainText('Accepted', { timeout: 15_000 });
    for (const kind of ['MATERIAL_STAGED', 'CUTTING'] as const) {
        await confirm(shopPage, `milestone-${kind}`);
        await expect(shopPage.getByTestId(`milestone-${kind}`)).toHaveCount(0, { timeout: 15_000 });
    }

    await viewer.goto(orderUrl);
    await expect(viewer.getByTestId('watch-card')).toContainText('Currently in production', { timeout: 20_000 });
    await viewer.getByTestId('watch-button').click();
    await viewer.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\/watch\?t=/);
    const kinds = () => viewer.getByTestId('watch-post').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    await expect.poll(kinds, { timeout: 15_000 }).toEqual(['cutting', 'material_staged', 'accepted', 'paid']);
    // The next step the shop posts appears on the stream by itself.
    await confirm(shopPage, 'milestone-QA');
    await expect.poll(kinds, { timeout: 25_000 }).toEqual(['qa', 'cutting', 'material_staged', 'accepted', 'paid']);
    await expect(viewer.getByTestId('watch-post').first()).toContainText('Inspection started');

    await shopPage.context().close();
    await viewerCtx.close();
    await creatorCtx.close();
});

test('a live auction: two bidders, the anti-snipe extension, the authorized top bid wins', async ({ browser }) => {
    test.setTimeout(240_000);
    const tag = runTag();
    const hostCtx = await signedInContext(browser, { email: `auction-host-${tag}@example.com`, name: 'Hal Host' }, { width: 1280, height: 800 });
    const host = await hostCtx.newPage();
    const handle = `hal_${tag}`.slice(0, 24);
    expect((await hostCtx.request.patch('/api/me', { data: { becomeCreator: true, handle } })).ok()).toBe(true);
    const quoted = await quotePart(host, 'auction-one-of-one.dxf');
    const buildId: string = (await (await hostCtx.request.get(`/api/parts/${quoted.partId}`)).json()).buildId;
    expect((await hostCtx.request.post('/api/live/channels', { data: { name: 'Hal Makes', handle, kind: 'creator', categories: ['workshop'] } })).ok()).toBe(true);
    const created = await hostCtx.request.post('/api/live/shows', { data: { title: 'One of one night', format: 'product_live', scheduledFor: new Date().toISOString(), featuredBuildIds: [buildId] } });
    const showId = (await created.json()).id as string;
    expect((await hostCtx.request.post(`/api/live/shows/${showId}/intents`, { data: { intent: 'start_show' } })).ok()).toBe(true);

    // Host starts a 90 s auction from the control room (room for cold dev compiles before the last 10 s).
    await host.goto(`/studio/shows/${showId}`);
    await host.getByTestId('auction-start').fill('400');
    await host.getByTestId('auction-increment').fill('10');
    await host.getByTestId('auction-seconds').fill('90');
    await host.getByTestId('auction-start-submit').click();
    await expect(host.getByTestId('control-auction')).toHaveAttribute('data-status', 'OPEN', { timeout: 15_000 });
    const auctionId: string = (await (await hostCtx.request.get(`/api/live/shows/${showId}`)).json()).auction.id;

    const bidders = await Promise.all(
        [1, 2].map(async (n) => {
            const ctx = await signedInContext(browser, { email: `bidder${n}-${tag}@example.com`, name: `Bidder ${n}` }, undefined, phone());
            const page = await ctx.newPage();
            await page.goto(`/live/${showId}`);
            await expect(page.getByTestId('auction-card')).toHaveAttribute('data-status', 'OPEN', { timeout: 15_000 });
            return { ctx, page };
        }),
    );
    const fill = async (page: (typeof bidders)[number]['page'], name: string) => {
        await page.getByTestId('bid-name').fill(name);
        await page.getByTestId('bid-line1').fill('1 Market St');
        await page.getByTestId('bid-city').fill('San Francisco');
        await page.getByTestId('bid-region').selectOption('CA');
        await page.getByTestId('bid-postal').fill('94105');
        await page.getByTestId('bid-terms').check();
    };

    // Bidder 1 takes the starting bid and authorizes the hold.
    const [one, two] = bidders;
    await one.page.getByTestId('auction-bid').click();
    await fill(one.page, 'Bidder One');
    await one.page.getByTestId('bid-submit').click();
    await one.page.getByTestId('bid-authorize').click();
    await expect(one.page.getByTestId('bid-result')).toHaveAttribute('data-status', 'AUTHORIZED', { timeout: 15_000 });
    await one.page.getByTestId('bid-sheet').getByRole('button', { name: 'Close' }).click();
    await expect(one.page.getByTestId('auction-card')).toHaveAttribute('data-leading', 'true', { timeout: 15_000 });

    // Bidder 2 sees the new price, prepares a bid and sends it inside the last 10 seconds.
    // "$400.00" alone also matches the starting-bid line; wait for bidder 1's bid itself.
    await expect(two.page.getByTestId('auction-current')).toContainText(/\$400\.00 · .* · 1 bid\b/, { timeout: 15_000 });
    await two.page.getByTestId('auction-bid').click();
    await expect(two.page.getByTestId('bid-amount')).toHaveValue('410.00');
    await fill(two.page, 'Bidder Two');
    const endsAt = new Date((await (await hostCtx.request.get(`/api/live/auctions/${auctionId}`)).json()).endsAt).getTime();
    await two.page.waitForTimeout(Math.max(0, endsAt - Date.now() - 7_000));
    await two.page.getByTestId('bid-submit').click();
    await expect(two.page.getByTestId('bid-result')).toHaveAttribute('data-extended', 'true', { timeout: 10_000 });
    await two.page.getByTestId('bid-authorize').click();
    await expect(two.page.getByTestId('bid-result')).toHaveAttribute('data-status', 'AUTHORIZED', { timeout: 10_000 });
    await two.page.getByTestId('bid-sheet').getByRole('button', { name: 'Close' }).click();
    const extended = await (await hostCtx.request.get(`/api/live/auctions/${auctionId}`)).json();
    expect(extended.extensions).toBe(1);
    expect(new Date(extended.endsAt).getTime()).toBe(endsAt + 15_000);
    await expect(two.page.getByTestId('auction-countdown')).toHaveAttribute('data-extensions', '1', { timeout: 10_000 });
    // Bidder 1 learns they were outbid.
    await expect(one.page.getByTestId('auction-outbid')).toBeVisible({ timeout: 15_000 });

    // The clock runs out: the auction closes lazily, the authorized top bid wins, the other hold is released.
    await expect
        .poll(async () => (await (await hostCtx.request.get(`/api/live/auctions/${auctionId}`)).json()).status, { timeout: 45_000, intervals: [2_000] })
        .toBe('SOLD');
    await expect(two.page.getByTestId('auction-card')).toHaveAttribute('data-status', 'SOLD', { timeout: 15_000 });
    await two.page.reload();
    await expect(two.page.getByTestId('auction-result')).toContainText('You won', { timeout: 15_000 });
    await one.page.reload();
    await expect(one.page.getByTestId('auction-result')).toContainText('released', { timeout: 15_000 });

    for (const b of bidders) await b.ctx.close();
    await hostCtx.close();
});
