/**
 * Make AI -> Build: version 1 graph from a persisted intent, idempotency per intent,
 * regulated refusal, the Materials Engineer (mocked model, constrained to the catalog)
 * and POST /api/make-ai/builds.
 */
import { and, eq } from 'drizzle-orm';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildGraphView } from '@/contracts/build-graph';
import { getGraph } from '@/server/build-graph';
import { builds, domainEvents, makeIntents } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent, makeAiRateLimiter } from '@/server/make-ai';
import { POST as createBuildRoute } from '@/app/api/make-ai/builds/route';
import { useTestDb } from '../support/db';
import { BRACKET_INTENT, ENCLOSURE_INTENT, insertIntent, materialAnswer, REGULATED_INTENT, textResult } from './fixtures';

const mock = vi.hoisted(() => ({ text: '' as string, error: null as Error | null }));

const model = new MockLanguageModelV4({
    provider: 'google.generative-ai',
    modelId: 'gemini-test-flash',
    doGenerate: async () => {
        if (mock.error) throw mock.error;
        return textResult(mock.text);
    },
});

vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => () => model }));

function setEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    resetEnvCache();
}

const noParams = { params: Promise.resolve({}) };
let ip = 0;
const post = (body: unknown) =>
    new Request('http://localhost:3100/api/make-ai/builds', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${++ip % 250}` },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });

describe('Make AI -> Build', () => {
    const ctx = useTestDb({ seed: true });

    beforeEach(() => {
        mock.text = JSON.stringify(materialAnswer());
        mock.error = null;
        model.doGenerateCalls.length = 0;
        makeAiRateLimiter.reset();
        setEnv({ MAKE_AI_ENABLED: 'true', GOOGLE_GENERATIVE_AI_API_KEY: undefined, MAKE_AI_MODEL: 'gemini-test-flash' });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        setEnv({ MAKE_AI_ENABLED: undefined, GOOGLE_GENERATIVE_AI_API_KEY: undefined, MAKE_AI_MODEL: undefined });
        vi.restoreAllMocks();
    });

    async function eventsFor(buildId: string) {
        return ctx.db.select().from(domainEvents).where(eq(domainEvents.buildId, buildId));
    }

    it('creates a NEEDS_INPUT build with a version 1 graph and links intent <-> build (no API key: no Materials Engineer)', async () => {
        const intentId = await insertIntent(ctx.db, ENCLOSURE_INTENT);
        const res = await createBuildFromIntent(intentId);
        expect(res.created).toBe(true);
        expect(model.doGenerateCalls).toHaveLength(0);

        const [build] = await ctx.db.select().from(builds).where(eq(builds.id, res.buildId));
        expect(build).toMatchObject({ origin: 'make_ai', status: 'NEEDS_INPUT', intentId, currentVersion: 1, name: 'Outdoor electronics enclosure', displayId: res.displayId });
        const [intentRow] = await ctx.db.select().from(makeIntents).where(eq(makeIntents.id, intentId));
        expect(intentRow!.buildId).toBe(res.buildId);

        const view = BuildGraphView.parse(await getGraph(res.buildId));
        const byKey = new Map(view.nodes.map((n) => [n.key, n]));
        expect(view.version).toMatchObject({ version: 1, status: 'DRAFT', summary: 'Drafted by Make AI from your description' });
        expect(byKey.get('build:root')).toMatchObject({ type: 'BUILD', label: 'Outdoor electronics enclosure', data: { displayId: res.displayId, riskClass: 'elevated', constraints: ['Must be weatherproof'] } });
        expect(byKey.get('req:R1')).toMatchObject({ type: 'REQUIREMENT', source: 'make_ai', confidence: 0.95, data: { category: 'function', requirementSource: 'user' } });
        expect(byKey.get('req:R3')).toMatchObject({ confidence: 0.55, data: { requirementSource: 'inferred' } });
        expect(byKey.get('unk:U1')).toMatchObject({ type: 'UNKNOWN', data: { status: 'open', topic: 'dimension', suggested_default: null, why: 'Every cut depends on real measurements.' } });
        expect(byKey.get('unk:U2')).toMatchObject({ data: { status: 'open', topic: 'quantity', suggested_default: '1' } });

        // First-cut decomposition without invented dimensions.
        expect(byKey.get('part:main')).toMatchObject({ type: 'PART', data: { dimensions: [], dimensionsStatus: 'needs_input' } });
        // Materials: catalog candidate + "needs sourcing" for anything outside the catalog.
        expect(byKey.get('mat:aluminum-5052')).toMatchObject({ label: 'Aluminum 5052-H32', data: { role: 'candidate', inCatalog: true, needsSourcing: false } });
        expect(byKey.get('mat:src-polycarbonate')).toMatchObject({ label: 'Polycarbonate (needs sourcing)', data: { inCatalog: false, needsSourcing: true } });
        // Processes matched to the catalog; a finish family is never narrowed to one colour.
        expect(byKey.get('proc:fiber-laser')).toMatchObject({ type: 'PROCESS', data: { inCatalog: true } });
        expect(byKey.get('proc:press-brake')).toMatchObject({ type: 'PROCESS' });
        expect(byKey.get('finish:powder-coat')).toMatchObject({ type: 'FINISH', label: 'Powder coat', data: { choice: null } });
        expect((byKey.get('finish:powder-coat')!.data.options as string[]).length).toBe(5);
        expect(byKey.get('proc:src-cnc-machining')).toMatchObject({ data: { needsSourcing: true } });

        const edges = view.edges.map((e) => `${e.type} ${e.fromKey} ${e.toKey}`);
        expect(edges).toEqual(
            expect.arrayContaining([
                'CONSTRAINED_BY build:root req:R1',
                'BLOCKED_BY build:root unk:U1',
                'CONTAINS build:root part:main',
                'MADE_OF part:main mat:aluminum-5052',
                'REQUIRES_PROCESS part:main proc:fiber-laser',
                'FINISHED_WITH part:main finish:powder-coat',
            ]),
        );

        const events = await eventsFor(res.buildId);
        expect(events.map((e) => e.eventType).sort()).toEqual(['build.created', 'design.version_created', 'requirements.generated']);
        expect(events.find((e) => e.eventType === 'requirements.generated')!.payload).toEqual({ buildId: res.buildId, version: 1, requirementCount: 3, unknownCount: 2 });
        expect(events.every((e) => e.correlationId === intentId)).toBe(true);
    });

    it('is idempotent per intent, also under concurrent calls', async () => {
        const intentId = await insertIntent(ctx.db, ENCLOSURE_INTENT);
        const [a, b] = await Promise.all([createBuildFromIntent(intentId), createBuildFromIntent(intentId)]);
        expect(a.buildId).toBe(b.buildId);
        expect([a.created, b.created].sort()).toEqual([false, true]);
        const again = await createBuildFromIntent(intentId);
        expect(again).toEqual({ buildId: a.buildId, displayId: a.displayId, created: false });
        expect(await ctx.db.select().from(builds).where(eq(builds.intentId, intentId))).toHaveLength(1);
        expect((await eventsFor(a.buildId)).filter((e) => e.eventType === 'build.created')).toHaveLength(1);
    });

    it('refuses regulated intents and unknown intents', async () => {
        const intentId = await insertIntent(ctx.db, REGULATED_INTENT);
        await expect(createBuildFromIntent(intentId)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
        const [row] = await ctx.db.select().from(makeIntents).where(eq(makeIntents.id, intentId));
        expect(row!.buildId).toBeNull();
        await expect(createBuildFromIntent('01920000-0000-7000-8000-00000000dead')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('writes the Materials Engineer recommendation as MATERIAL nodes and emits material.recommended', async () => {
        setEnv({ GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key' });
        const intentId = await insertIntent(ctx.db, ENCLOSURE_INTENT);
        const res = await createBuildFromIntent(intentId);

        expect(model.doGenerateCalls).toHaveLength(1);
        const call = model.doGenerateCalls[0]!;
        expect(call.responseFormat?.type).toBe('json');
        // The structured-output schema only allows catalog slugs (+ needs_sourcing).
        const schema = JSON.stringify(call.responseFormat);
        for (const slug of ['aluminum-5052', 'mild-steel-cr', 'hardwood-walnut', 'needs_sourcing']) expect(schema).toContain(slug);
        expect(JSON.stringify(call.prompt)).toContain('aluminum-5052: Aluminum 5052-H32');

        const view = (await getGraph(res.buildId))!;
        const byKey = new Map(view.nodes.map((n) => [n.key, n]));
        expect(byKey.get('mat:aluminum-5052')).toMatchObject({
            label: 'Aluminum 5052-H32',
            confidence: 0.72,
            provenance: 'materials_engineer:gemini-test-flash',
            data: {
                role: 'recommended',
                name: 'Aluminum 5052-H32',
                inCatalog: true,
                costEffect: 'similar',
                leadTimeEffect: 'similar',
                tradeoffs: ['Aluminum dents more easily than steel.'],
                alsoSuggestedBy: ['candidate'],
            },
        });
        expect(byKey.get('mat:stainless-304')).toMatchObject({ label: 'Stainless steel 304 (2B)', data: { role: 'alternative', tradeoff: 'Heavier and slower to cut.' } });
        expect(byKey.get('mat:src-polycarbonate')).toMatchObject({ label: 'Polycarbonate (needs sourcing)', data: { role: 'alternative', needsSourcing: true } });
        expect(view.nodes.filter((n) => n.type === 'MATERIAL')).toHaveLength(3);

        const [recommended] = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.buildId, res.buildId), eq(domainEvents.eventType, 'material.recommended')));
        expect(recommended!.payload).toEqual({ buildId: res.buildId, version: 1, material: 'Aluminum 5052-H32', confidence: 0.72 });
    });

    it('never blocks build creation: an off-catalog slug or a provider error just skips the engineer', async () => {
        setEnv({ GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key' });
        mock.text = JSON.stringify(materialAnswer({ recommended: { catalog_slug: 'titanium-grade-5', material: 'Titanium', why: 'Light.' } }));
        const a = await createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT));
        expect(a.created).toBe(true);
        const nodesA = (await getGraph(a.buildId))!.nodes;
        expect(nodesA.some((n) => n.key.includes('titanium'))).toBe(false);
        expect(nodesA.find((n) => n.key === 'mat:aluminum-5052')!.data.role).toBe('candidate');
        expect((await eventsFor(a.buildId)).some((e) => e.eventType === 'material.recommended')).toBe(false);

        mock.error = new Error('upstream down');
        const b = await createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT));
        expect(b.created).toBe(true);
    });

    it('a buyer-stated size lands on the part; no open questions means a DRAFT build', async () => {
        const res = await createBuildFromIntent(await insertIntent(ctx.db, BRACKET_INTENT));
        const [build] = await ctx.db.select().from(builds).where(eq(builds.id, res.buildId));
        expect(build!.status).toBe('DRAFT');
        const view = (await getGraph(res.buildId))!;
        const byKey = new Map(view.nodes.map((n) => [n.key, n]));
        expect(byKey.get('part:main')!.data).toMatchObject({ dimensions: [{ text: 'Arm is 200 mm long, 3 mm thick', from: 'req:R2' }], dimensionsStatus: 'stated' });
        expect(byKey.get('mat:mild-steel-cr')).toBeTruthy();
        // "Laser cutting" is ambiguous: resolved to the laser that cuts the candidate material.
        expect(byKey.get('proc:fiber-laser')).toBeTruthy();
        expect(byKey.get('proc:co2-laser')).toBeUndefined();
        expect(byKey.get('proc:press-brake')).toBeTruthy();
        expect(view.edges.some((e) => e.type === 'CONSTRAINED_BY' && e.fromKey === 'part:main' && e.toKey === 'req:R2')).toBe(true);
    });

    describe('POST /api/make-ai/builds', () => {
        it('404 when Make AI is disabled', async () => {
            setEnv({ MAKE_AI_ENABLED: 'false' });
            const res = await createBuildRoute(post({ intentId: await insertIntent(ctx.db, ENCLOSURE_INTENT) }), noParams);
            expect(res.status).toBe(404);
        });

        it('201 on create, 200 when the intent already has a build; 403 regulated, 404 unknown, 400 bad body', async () => {
            const intentId = await insertIntent(ctx.db, ENCLOSURE_INTENT);
            const first = await createBuildRoute(post({ intentId }), noParams);
            expect(first.status).toBe(201);
            const body = await first.json();
            expect(body).toMatchObject({ buildId: expect.stringMatching(/^bld_/), displayId: expect.stringMatching(/^DM-/), created: true });
            const second = await createBuildRoute(post({ intentId }), noParams);
            expect(second.status).toBe(200);
            expect((await second.json()).buildId).toBe(body.buildId);

            expect((await createBuildRoute(post({ intentId: await insertIntent(ctx.db, REGULATED_INTENT) }), noParams)).status).toBe(403);
            expect((await createBuildRoute(post({ intentId: 'nope' }), noParams)).status).toBe(404);
            expect((await createBuildRoute(post({}), noParams)).status).toBe(400);
            expect((await createBuildRoute(post('{oops'), noParams)).status).toBe(400);
        });

        it('shares the Make AI per-IP rate limit', async () => {
            const intentId = await insertIntent(ctx.db, ENCLOSURE_INTENT);
            const req = () =>
                new Request('http://localhost:3100/api/make-ai/builds', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.77' }, body: JSON.stringify({ intentId }) });
            for (let i = 0; i < 10; i++) expect((await createBuildRoute(req(), noParams)).status).toBeLessThan(300);
            const limited = await createBuildRoute(req(), noParams);
            expect(limited.status).toBe(429);
            expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
        });
    });
});
