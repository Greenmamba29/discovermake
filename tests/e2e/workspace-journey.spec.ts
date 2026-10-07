/**
 * R2 Build Workspace journey through the real UI and APIs:
 *   a stored Make AI plan (no model call in e2e) -> Continue to Build -> answer the
 *   NEEDS_INPUT question cards -> approve the version -> Remix into a new build.
 * The plan is inserted straight into `make_intents`, exactly as intake persists it.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL } from '../../playwright.config';

const INTENT = {
    intent: 'create',
    product_type: 'wall shelf bracket',
    summary: 'A bent steel bracket for a wall shelf.',
    requirements: [{ id: 'R1', text: 'Holds a 10 kg shelf', category: 'function', source: 'user', confidence: 0.9 }],
    constraints: [],
    unknowns: [
        { question: 'What are the leg lengths and width of the bracket?', why_it_matters: 'Every cut depends on real measurements.' },
        { question: 'How many brackets do you need?', why_it_matters: 'Quantity changes setup cost per unit.', suggested_default: '4' },
    ],
    materials_suggested: [{ material: 'Mild steel', why: 'Strong and bends well.' }],
    processes_suggested: ['Laser cutting', 'Bending'],
    risk_class: 'standard',
    required_specialists: [],
};

test('a Make AI plan becomes a versioned Build, gets answered, approved and remixed', async ({ page, request }) => {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    const intentId = randomUUID();
    try {
        await sql`insert into make_intents (id, intent, model, prompt_sha256, prompt_chars) values (${intentId}, ${sql.json(INTENT)}, ${'e2e'}, ${'0'.repeat(64)}, ${42})`;
    } finally {
        await sql.end();
    }

    const res = await request.post('/api/make-ai/builds', { data: { intentId } });
    expect(res.status()).toBe(201);
    const { buildId } = await res.json();

    await page.goto(`/build/${buildId}/workspace`);
    await expect(page.getByTestId('workspace-status-strip')).toContainText(/concept/i);
    await expect(page.getByTestId('workspace-open-questions')).toContainText('2');

    // Answer both NEEDS_INPUT cards: one typed, one with the suggested default.
    await page.getByTestId('section-questions').click();
    const dims = page.locator('[data-testid^="question-"]').filter({ hasText: 'leg lengths' });
    await dims.getByRole('textbox').fill('Legs 50 mm and 80 mm, 40 mm wide');
    await dims.getByRole('button', { name: 'Save answer' }).click();
    const qty = page.locator('[data-testid^="question-"]').filter({ hasText: 'How many' });
    await qty.getByRole('button', { name: 'Use this default' }).click();
    await expect(page.getByTestId('workspace-open-questions')).toContainText('None open', { timeout: 15_000 });

    // Approve the latest version: it becomes immutable.
    await page.getByTestId('section-versions').click();
    const current = await (await request.get(`/api/builds/${buildId}/graph`)).json();
    const version: number = current.build.currentVersion;
    const latest = `approve-v${version}`;
    await page.getByTestId(latest).click();
    await page.getByTestId(`${latest}-confirm`).click();
    await expect
        .poll(async () => (await (await request.get(`/api/builds/${buildId}/graph`)).json()).version.status, { timeout: 15_000 })
        .toBe('APPROVED');
    await expect(page.getByTestId(`approve-v${version}`)).toHaveCount(0);

    // The buyer's typed dimensions are now user-sourced requirements on the approved version.
    const graph = await (await request.get(`/api/builds/${buildId}/graph`)).json();
    expect(graph.nodes.some((n: { type: string; data: { requirementSource?: string; text?: string } }) => n.type === 'REQUIREMENT' && n.data.text?.includes('80 mm'))).toBe(true);

    // Remix: a new build derived from the approved version.
    await page.getByTestId('section-overview').click();
    await page.getByRole('button', { name: 'Remix' }).click();
    await page.waitForURL((url) => url.pathname.endsWith('/workspace') && !url.pathname.includes(buildId), { timeout: 20_000 });
    const remixId = page.url().split('/build/')[1]!.split('/')[0]!;
    const remix = await (await request.get(`/api/builds/${remixId}/graph`)).json();
    expect(remix.build.origin).toBe('remix');
    expect(remix.build.derivedFromBuildId).toBe(buildId);
});
