/**
 * Media e2e helpers: publish through Creator Studio, a show that ends with a replay, the
 * part configurator on an existing part, and admin calls for creator payouts.
 */
import { expect, type APIRequestContext, type Browser, type Cookie, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ADMIN_TOKEN, E2E_DATABASE_URL } from '../../../playwright.config';
import { signedInContext } from './live';

/** Creator Studio · Publishing: publish `buildId` publicly with a commercial licence. */
export async function publishViaStudio(page: Page, buildId: string, opts: { title: string; royaltyPct: number; tags: string }) {
    await page.goto('/studio/publish');
    const row = page.locator(`[data-testid="publish-row"][data-build-id="${buildId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId('publish-toggle').click();
    await row.getByTestId('publish-visibility-public').check();
    await row.getByTestId('publish-license-commercial').check();
    await row.getByTestId('publish-royalty').fill(String(opts.royaltyPct));
    await row.getByTestId('publish-title').fill(opts.title);
    await row.getByTestId('publish-tags').fill(opts.tags);
    await row.getByTestId('publish-save').click();
    await expect(row.getByTestId('publish-message')).toContainText('Published', { timeout: 15_000 });
    await expect(row).toHaveAttribute('data-visibility', 'public', { timeout: 15_000 });
}

/** Channel (if missing) + a show featuring `buildId` that goes live, features it, and ends with the committed replay fixture. */
export async function showWithReplay(api: APIRequestContext, opts: { handle: string; buildId: string; title: string; liveMs?: number; extraBuildId?: string }) {
    const channel = await api.post('/api/live/channels', { data: { name: 'Amanda Makes', handle: opts.handle, kind: 'creator', categories: ['workshop'], bio: 'Lamps and brackets, made live.' } });
    expect(channel.ok(), await channel.text()).toBe(true);
    const res = await api.post('/api/live/shows', { data: { title: opts.title, format: 'creator_live', scheduledFor: new Date().toISOString(), featuredBuildIds: [opts.buildId] } });
    expect(res.status(), await res.text()).toBe(201);
    const showId = (await res.json()).id as string;
    const intent = async (data: Record<string, unknown>) => {
        const r = await api.post(`/api/live/shows/${showId}/intents`, { data });
        expect(r.ok(), await r.text()).toBe(true);
    };
    await intent({ intent: 'start_show' });
    await new Promise((r) => setTimeout(r, 1500));
    await intent({ intent: 'feature_product', buildId: opts.buildId });
    await new Promise((r) => setTimeout(r, opts.liveMs ?? 4000));
    await intent({ intent: 'end_show' });
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        await sql`update shows set replay_url = ${'/live/demo-replay.webm'} where id = ${showId}`;
    } finally {
        await sql.end();
    }
    return showId;
}

/** On a `/parts/:partId` page: pick 6061 / 0.090" until the quote is binding, then go to checkout. */
export async function configureToCheckout(page: Page) {
    await page.getByTestId('material-option-mat_al_6061').click();
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 20_000 });
    await page.getByTestId('checkout-cta').click();
    await page.waitForURL(/\/checkout\/qte_/);
}

/** Checkout with the dev payment double as `email`; lands on the signed order link. */
export async function payAs(page: Page, email: string, name: string) {
    await page.getByTestId('checkout-email').fill(email);
    await page.getByTestId('checkout-name').fill(name);
    await page.getByTestId('checkout-line1').fill('1 Market St');
    await page.getByTestId('checkout-city').fill('San Francisco');
    await page.getByTestId('checkout-region').selectOption('CA');
    await page.getByTestId('checkout-postal').fill('94105');
    await page.getByTestId('shipping-option-STANDARD').click();
    await page.getByTestId('checkout-terms').check();
    await page.getByTestId('pay-cta').click();
    await page.getByTestId('dev-pay-button').click();
    await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 30_000 });
    const orderUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
    await expect(page.getByTestId('order-status')).toContainText(/waiting for the shop/i, { timeout: 30_000 });
    const orderNumber = (await page.locator('text=/DMO-[A-Z0-9]+/').first().textContent())!.match(/DMO-[A-Z0-9]+/)![0];
    return { orderUrl, orderNumber };
}

export function adminHeaders() {
    return { authorization: `Bearer ${E2E_ADMIN_TOKEN}` };
}

export type MediaSweepState = {
    buildUrl: string;
    channelUrl: string;
    clipUrl: string;
    watchUrl: string;
    auctionShowUrl: string;
    creatorCookies: Cookie[];
};

/**
 * Page-sweep state for Media: a creator with a published build (commercial licence), a channel
 * with an ended show + replay + clip, a live show running an auction, a royalty earned on a
 * viewer's Make This order (so Insights / Payouts have numbers), and that order's Watch link.
 */
export async function buildMediaSweepState(browser: Browser, quotePart: (page: Page, name: string) => Promise<{ partId: string }>): Promise<MediaSweepState> {
    const run = Date.now().toString(36);
    const creatorCtx = await signedInContext(browser, { email: `sweep-media-${run}@example.com`, name: 'Media Sweeper' });
    const api = creatorCtx.request;
    const handle = `media_${run}`.slice(0, 24);
    expect((await api.patch('/api/me', { data: { becomeCreator: true, handle } })).ok()).toBe(true);
    const page = await creatorCtx.newPage();
    const quoted = await quotePart(page, 'sweep-media-lamp.dxf');
    const buildId: string = (await (await api.get(`/api/parts/${quoted.partId}`)).json()).buildId;
    const pub = await api.post(`/api/media/builds/${buildId}/publish`, { data: { visibility: 'public', license: 'commercial', royaltyPct: 10, title: 'Sweep walnut lamp plate', tags: ['lighting', 'desk-setup'], description: 'A laser-cut plate for a desk lamp arm.' } });
    expect(pub.ok(), await pub.text()).toBe(true);
    const showId = await showWithReplay(api, { handle, buildId, title: 'Sweep lamp night', liveMs: 3000 });
    const clipsRes = await api.get(`/api/media/shows/${showId}/clips`);
    expect(clipsRes.ok(), await clipsRes.text()).toBe(true);
    const clips = await clipsRes.json();
    const s = clips.suggestions[0];
    const clip = await api.post(`/api/media/shows/${showId}/clips`, { data: { startMs: s.startMs, endMs: s.endMs, title: 'Sweep lamp reveal', buildId } });
    expect(clip.status(), await clip.text()).toBe(201);
    const clipId = (await clip.json()).id as string;

    // A live show with a running auction.
    const created = await api.post('/api/live/shows', { data: { title: 'Sweep one-of-one auction', format: 'product_live', scheduledFor: new Date().toISOString(), featuredBuildIds: [buildId] } });
    expect(created.status(), await created.text()).toBe(201);
    const auctionShow = (await created.json()).id as string;
    for (const data of [{ intent: 'start_show' }, { intent: 'feature_product', buildId }, { intent: 'start_auction', buildId, startingBidCents: 40_000, minIncrementCents: 1_000, durationSeconds: 3_600 }]) {
        const r = await api.post(`/api/live/shows/${auctionShow}/intents`, { data });
        expect(r.ok(), await r.text()).toBe(true);
    }
    const creatorCookies = await creatorCtx.cookies();
    await creatorCtx.close();

    // A viewer makes a copy from the clip and orders it: the creator earns the royalty.
    const viewerCtx = await signedInContext(browser, { email: `sweep-media-viewer-${run}@example.com`, name: 'Sweep Viewer' });
    const made = await viewerCtx.request.post(`/api/media/builds/${buildId}/make`, { data: { kind: 'clone', via: clipId } });
    expect(made.status(), await made.text()).toBe(201);
    const viewer = await viewerCtx.newPage();
    await viewer.goto((await made.json()).nextUrl);
    await configureToCheckout(viewer);
    const { orderUrl } = await payAs(viewer, `sweep-media-viewer-${run}@example.com`, 'Sweep Viewer');
    await viewerCtx.close();
    const [orderPath, query] = orderUrl.split('?');
    return { buildUrl: `/b/${buildId}`, channelUrl: `/c/${handle}`, clipUrl: `/clips/${clipId}`, watchUrl: `${orderPath}/watch?${query}`, auctionShowUrl: `/live/${auctionShow}`, creatorCookies };
}
