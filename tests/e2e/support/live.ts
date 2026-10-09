/**
 * Live e2e helpers: signed-in contexts through the accounts stub's dev-only header
 * (`x-dm-test-user`, removed when the R2 accounts module lands), an approved Make AI build,
 * and Creator Studio setup.
 */
import { randomUUID } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL } from '../../../playwright.config';

export const RUN = Date.now().toString(36);
export const LIVE_CREATOR = { id: `usr_e2ecreator${RUN}`, header: `id=usr_e2ecreator${RUN};roles=buyer,creator;name=Amanda%20Maker;email=amanda-${RUN}@example.com` };
export const LIVE_VIEWER = { id: `usr_e2eviewer${RUN}`, header: `id=usr_e2eviewer${RUN};roles=buyer;name=Vic%20Viewer;email=vic-${RUN}@example.com` };

export async function signedInContext(browser: Browser, header: string, viewport?: { width: number; height: number }): Promise<BrowserContext> {
    return browser.newContext({ extraHTTPHeaders: { 'x-dm-test-user': header }, ...(viewport ? { viewport } : {}) });
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

