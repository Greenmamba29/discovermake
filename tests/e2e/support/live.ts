/**
 * Live e2e helpers: real email sign-in (accounts module), an approved Make AI build, and
 * Creator Studio setup (become a creator, channel, show planner).
 */
import { randomUUID } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Cookie, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL } from '../../../playwright.config';

export const RUN = Date.now().toString(36);
export const LIVE_CREATOR = { email: `amanda-${RUN}@example.com`, name: 'Amanda Maker' };
export const LIVE_VIEWER = { email: `vic-${RUN}@example.com`, name: 'Vic Viewer' };

export type SignedInState = { cookies: Cookie[] };

/** Real email sign-in (accounts module; the code comes back as `devCode` outside production). */
export async function signIn(context: BrowserContext, who: { email: string; name: string }): Promise<void> {
    // Own client IP per sign-in so the in-memory per-IP code limits never trip across specs.
    const headers = { 'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` };
    const start = await context.request.post('/api/auth/email/start', { data: { email: who.email }, headers });
    expect(start.status(), await start.text()).toBe(201);
    const { challengeId, devCode } = await start.json();
    const verify = await context.request.post('/api/auth/email/verify', { data: { challengeId, code: devCode }, headers });
    expect(verify.ok(), await verify.text()).toBe(true);
    const named = await context.request.patch('/api/me', { data: { displayName: who.name } });
    expect(named.ok(), await named.text()).toBe(true);
}

export async function signedInContext(
    browser: Browser,
    who: { email: string; name: string },
    viewport?: { width: number; height: number },
    options: BrowserContextOptions = {},
): Promise<BrowserContext> {
    const context = await browser.newContext({ ...options, ...(viewport ? { viewport } : {}) });
    await signIn(context, who);
    return context;
}

/** A Make AI build with an APPROVED version (Make Mine clones it), created like the workspace journey does. */
export async function approvedGraphBuild(page: Page, productType = 'carbon desk lamp'): Promise<string> {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    const intentId = randomUUID();
    try {
        await sql`insert into make_intents (id, intent, model, prompt_sha256, prompt_chars) values (${intentId}, ${sql.json({
            intent: 'create',
            product_type: productType,
            summary: `A laser-cut ${productType} with a bent aluminum arm.`,
            requirements: [{ id: 'R1', text: 'Arm reaches 400 mm over the desk', category: 'dimension', source: 'user', confidence: 1 }],
            constraints: [],
            unknowns: [],
            materials_suggested: [{ material: 'Aluminum 5052', why: 'Bends cleanly.' }],
            processes_suggested: ['Laser cutting', 'Bending'],
            risk_class: 'standard',
            required_specialists: [],
        })}, ${'e2e'}, ${'0'.repeat(64)}, ${24})`;
    } finally {
        await sql.end();
    }
    const made = await (await page.request.post('/api/make-ai/builds', { data: { intentId } })).json();
    const graph = await (await page.request.get(`/api/builds/${made.buildId}/graph`)).json();
    const res = await page.request.post(`/api/builds/${made.buildId}/versions/${graph.build.currentVersion}/approve`);
    expect(res.status()).toBe(200);
    return made.buildId as string;
}

/** Creator Studio: channel + a scheduled show featuring `buildIds`; returns the show id (on the control room page). */
export async function setUpShow(page: Page, buildIds: string[], title: string) {
    await page.goto('/studio');
    await expect(page.getByTestId('go-live-checklist')).toBeVisible();
    if (await page.getByTestId('become-creator').isVisible()) {
        await page.getByTestId('creator-handle').fill(`amanda_${RUN}`.slice(0, 24));
        await page.getByRole('button', { name: 'Become a creator' }).click();
        await expect(page.getByTestId('channel-form')).toBeVisible();
    }
    if (await page.getByTestId('channel-form').isVisible()) {
        await page.getByTestId('channel-name').fill('Amanda Makes');
        await page.getByTestId('channel-handle').fill(`amanda_${RUN}`.slice(0, 24));
        await page.getByTestId('channel-category-drops').click();
        await page.getByTestId('channel-category-workshop').click();
        await page.getByTestId('channel-save').click();
        await expect(page.getByTestId('channel-summary')).toBeVisible();
    }
    await expect(page.getByTestId('checklist-channel')).toHaveAttribute('data-done', 'true');
    await page.getByTestId('show-title-input').fill(title);
    await page.getByTestId('show-builds').fill(buildIds.join('\n'));
    await page.getByTestId('show-create').click();
    await expect(page.getByTestId('studio-show').filter({ hasText: title })).toBeVisible();
    await expect(page.getByTestId('checklist-featured_product')).toHaveAttribute('data-done', 'true');
    await page.getByTestId('studio-show').filter({ hasText: title }).getByTestId('control-room-link').click();
    await page.waitForURL(/\/studio\/shows\/shw_/);
    return page.url().match(/shw_[A-Za-z0-9_-]+/)![0];
}


export type LiveSweepState = { liveShowUrl: string; replayShowUrl: string; controlRoomUrl: string; creatorCookies: Cookie[] };

/**
 * Page-sweep state for Live: a creator with a channel, a LIVE show featuring a build with an
 * orderable quote and an open drop (plus chat, a question and a poll), and an ENDED replay
 * whose source is the committed WebM fixture. The creator's cookies are returned so studio
 * screens can reuse the session instead of signing in again.
 */
export async function buildLiveSweepState(browser: Browser, quotePart: (page: Page, name: string) => Promise<{ partId: string }>): Promise<LiveSweepState> {
    const creator = { email: `sweep-creator-${RUN}@example.com`, name: 'Sweep Creator' };
    const context = await signedInContext(browser, creator);
    const api = context.request;
    const handle = `sweep_${RUN}`.slice(0, 24);
    expect((await api.patch('/api/me', { data: { becomeCreator: true, handle } })).ok()).toBe(true);
    const page = await context.newPage();
    const quoted = await quotePart(page, 'sweep-live-lamp.dxf');
    const buildId: string = (await (await api.get(`/api/parts/${quoted.partId}`)).json()).buildId;
    expect((await api.post('/api/live/channels', { data: { name: 'Sweep Workshop', handle, kind: 'creator', categories: ['drops', 'workshop'], bio: 'Page sweep channel.' } })).ok()).toBe(true);

    const create = async (title: string) => {
        const res = await api.post('/api/live/shows', { data: { title, format: 'live_drop', scheduledFor: new Date().toISOString(), featuredBuildIds: [buildId] } });
        expect(res.status(), await res.text()).toBe(201);
        return (await res.json()).id as string;
    };
    const intent = async (showId: string, data: Record<string, unknown>) => {
        const res = await api.post(`/api/live/shows/${showId}/intents`, { data });
        expect(res.ok(), await res.text()).toBe(true);
    };

    // A scheduled show keeps the go-live checklist meaningful; the live one carries the drop.
    await create('Sweep: next week workshop');
    const live = await create('Sweep: lamp build night');
    await intent(live, { intent: 'start_show' });
    await intent(live, { intent: 'feature_product', buildId });
    await intent(live, { intent: 'start_drop', buildId, priceCents: 25_000, totalSlots: 50, thresholdSlots: 1, perBuyerLimit: 2, durationMinutes: 600 });
    await intent(live, { intent: 'create_poll', question: 'Which finish next?', options: ['Black powder coat', 'Raw aluminum'] });
    await api.post(`/api/live/shows/${live}/chat`, { data: { text: 'Welcome in, the laser is warming up.' } });
    await api.post(`/api/live/shows/${live}/questions`, { data: { mode: 'make_ai', text: 'What is it made of?' } });

    const replay = await create('Sweep: last week factory tour');
    await intent(replay, { intent: 'start_show' });
    await intent(replay, { intent: 'feature_product', buildId });
    await api.post(`/api/live/shows/${replay}/chat`, { data: { text: 'Thanks for watching!' } });
    await intent(replay, { intent: 'end_show' });
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        await sql`update shows set replay_url = ${'/live/demo-replay.webm'} where id = ${replay}`;
    } finally {
        await sql.end();
    }
    const creatorCookies = await context.cookies();
    await context.close();
    return { liveShowUrl: `/live/${live}`, replayShowUrl: `/live/${replay}`, controlRoomUrl: `/studio/shows/${live}`, creatorCookies };
}
