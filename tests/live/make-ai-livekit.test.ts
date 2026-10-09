/**
 * Ask Make AI guardrails (certification template, offline deterministic answers, no invented
 * numbers) and the LiveKit token service (grants per role) + webhook verification.
 */
import { MockLanguageModelV4 } from 'ai/test';
import { AccessToken } from 'livekit-server-sdk';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as questionsRoute } from '@/app/api/live/shows/[showId]/questions/route';
import { POST as tokenRoute } from '@/app/api/live/shows/[showId]/token/route';
import { POST as livekitWebhook } from '@/app/api/webhooks/livekit/route';
import { liveEvents, shows } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { answerLiveQuestion, CERTIFICATION_TEMPLATE, handleIntent, loadBuildFacts, resetLiveRateLimits } from '@/server/live';
import { factsFor, numbersIn, usesOnlyKnownNumbers } from '@/server/live/make-ai-answer';
import { useTestDb } from '../support/db';
import { textResult } from '../build-graph/fixtures';
import { quietConsole } from '../orders/fixtures';
import { req, setupShow, makeUser } from './fixtures';

vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async () => null }));

const params = (showId: string) => ({ params: Promise.resolve({ showId }) });

function mockModel(answer: string) {
    return new MockLanguageModelV4({ provider: 'google.generative-ai', modelId: 'gemini-test', doGenerate: async () => textResult(JSON.stringify({ answer, answerable: true })) });
}

function setEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    resetEnvCache();
}

function decodeJwt(token: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

describe('Ask Make AI on a live show', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());
    afterEach(async () => {
        await resetLiveRateLimits();
        setEnv({ MAKE_AI_ENABLED: undefined, GOOGLE_GENERATIVE_AI_API_KEY: undefined });
    });

    it('safety and certification questions get the conservative template, never a model answer', async () => {
        const { fixture } = await setupShow(ctx.db, { start: false });
        const facts = await loadBuildFacts(fixture.build.id);
        const model = mockModel('Yes, it is UL certified and food safe.');
        const spy = vi.spyOn(model, 'doGenerate');
        for (const q of ['Is this UL certified?', 'Is it food safe?', 'What load rating does it have?', 'Is it safe for kids?']) {
            const a = await answerLiveQuestion(q, facts, { model });
            expect(a).toMatchObject({ answer: CERTIFICATION_TEMPLATE, source: 'template' });
        }
        expect(spy).not.toHaveBeenCalled();
        expect(CERTIFICATION_TEMPLATE).toMatch(/final certification depends on production configuration/i);
    });

    it('when Make AI is disabled or keyless, answers deterministically from the build record and says so', async () => {
        const { show, fixture, hostAccess } = await setupShow(ctx.db);
        await handleIntent(await hostAccess(), { intent: 'feature_product', buildId: fixture.build.id });
        const viewer = await makeUser('asker');
        const res = await questionsRoute(req(`/api/live/shows/${show.id}/questions`, { user: viewer, body: { mode: 'make_ai', text: 'What is it made of and how much is it?' } }), params(show.id));
        expect(res.status).toBe(201);
        const { question } = await res.json();
        expect(question.answeredBy).toBe('make_ai');
        expect(question.answer).toMatch(/build record/i);
        expect(question.answer).toContain('5052 Aluminum');
        expect(question.answer).toContain('5.00 USD each at quantity 10');
        const answered = await ctx.db.select().from(liveEvents).where(eq(liveEvents.showId, show.id));
        const ev = answered.find((e) => e.event === 'question.answered')!;
        expect(ev.payload).toMatchObject({ answeredBy: 'make_ai', source: 'record', offline: true });
    });

    it('never invents numbers: a model answer with a number outside the record falls back to the record', async () => {
        const { fixture } = await setupShow(ctx.db, { start: false });
        const facts = await loadBuildFacts(fixture.build.id);
        const lines = factsFor(facts);
        const invented = await answerLiveQuestion('How heavy is it?', facts, { model: mockModel('It weighs about 312 g and ships in 2 days.') });
        expect(invented.source).toBe('record');
        expect(invented.answer).not.toContain('312');
        expect(usesOnlyKnownNumbers(invented.answer, lines, 'How heavy is it?')).toBe(true);
        const grounded = await answerLiveQuestion('How heavy is it?', facts, { model: mockModel('About 14 g each, in 5052 Aluminum.') });
        expect(grounded).toMatchObject({ source: 'model', answer: 'About 14 g each, in 5052 Aluminum.' });
        expect(numbersIn('1,250.00 and 0.090')).toEqual(['1250', '0.09']);
    });

    it('with no featured product it says there is no record, instead of guessing', async () => {
        const a = await answerLiveQuestion('How much is it?', null);
        expect(a.answer).toMatch(/No product is featured/);
        expect(numbersIn(a.answer)).toEqual([]);
    });
});

describe('LiveKit token service and webhooks', () => {
    const ctx = useTestDb({ seed: true });
    const KEY = 'APItestkey';
    const SECRET = 'livekit-test-secret-0123456789abcdef0123456789';
    beforeAll(() => quietConsole());
    afterEach(() => setEnv({ LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined }));

    it('without LiveKit config, the token endpoint answers livekit: null with the show source', async () => {
        const { show } = await setupShow(ctx.db);
        const res = await tokenRoute(req(`/api/live/shows/${show.id}/token`, { method: 'POST' }), params(show.id));
        const body = await res.json();
        expect(body).toMatchObject({ livekit: null, role: 'viewer', source: { kind: 'none' } });
        const hook = await livekitWebhook(req('/api/webhooks/livekit', { body: {} }), { params: Promise.resolve({}) });
        expect(hook.status).toBe(404);
    });

    it('issues role-scoped grants: host admin+publish, viewer subscribe-only with no data publish', async () => {
        setEnv({ LIVEKIT_URL: 'wss://dm-test.livekit.cloud', LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET });
        const { show, host } = await setupShow(ctx.db, { start: false });
        // Start without reaching the network: room creation is best effort.
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
        await handleIntent(await (await import('@/server/live')).loadShowAccess(req('/', { user: host }), show.id), { intent: 'start_show' });
        fetchSpy.mockRestore();
        const [row] = await ctx.db.select().from(shows).where(eq(shows.id, show.id));
        expect(row.livekitRoom).toBe(`dm-${show.id}`);

        const hostTok = await (await tokenRoute(req(`/api/live/shows/${show.id}/token`, { method: 'POST', user: host }), params(show.id))).json();
        expect(hostTok.role).toBe('host');
        expect(hostTok.livekit.url).toBe('wss://dm-test.livekit.cloud');
        const hostClaims = decodeJwt(hostTok.livekit.token);
        expect(hostClaims.sub).toBe(host.id);
        expect(hostClaims.video).toMatchObject({ room: row.livekitRoom, roomJoin: true, roomAdmin: true, canPublish: true, canPublishData: true, canSubscribe: true });

        const viewer = await makeUser('watcher');
        const viewTok = await (await tokenRoute(req(`/api/live/shows/${show.id}/token`, { method: 'POST', user: viewer }), params(show.id))).json();
        const v = decodeJwt(viewTok.livekit.token);
        expect(viewTok.role).toBe('viewer');
        expect(v.video).toMatchObject({ room: row.livekitRoom, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false });
        expect((v.video as Record<string, unknown>).roomAdmin).toBeFalsy();
        expect(Number(v.exp) - Number(v.nbf ?? v.iat ?? Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(15 * 60 + 5);

        const anon = await (await tokenRoute(req(`/api/live/shows/${show.id}/token`, { method: 'POST' }), params(show.id))).json();
        expect(String(decodeJwt(anon.livekit.token).sub)).toMatch(/^anon-/);
    });

    it('verifies webhook signatures: forged or tampered bodies are rejected, valid ones update viewer counts', async () => {
        setEnv({ LIVEKIT_URL: 'wss://dm-test.livekit.cloud', LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET });
        const { show } = await setupShow(ctx.db);
        const room = `dm-${show.id}`;
        await ctx.db.update(shows).set({ livekitRoom: room }).where(eq(shows.id, show.id));
        const body = JSON.stringify({ event: 'participant_joined', id: 'EV_1', createdAt: Math.floor(Date.now() / 1000), room: { name: room, numParticipants: 7 } });
        const sign = async (payload: string, secret = SECRET) => {
            const at = new AccessToken(KEY, secret);
            at.sha256 = createHash('sha256').update(payload).digest('base64');
            return at.toJwt();
        };
        const post = (payload: string, auth: string | null) =>
            livekitWebhook(new Request('http://localhost:3100/api/webhooks/livekit', { method: 'POST', body: payload, headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({}) });

        expect((await post(body, null)).status).toBe(401);
        expect((await post(body, await sign(body, 'wrong-secret-wrong-secret-wrong-secret'))).status).toBe(401);
        expect((await post(body.replace('"numParticipants":7', '"numParticipants":9000'), await sign(body))).status).toBe(401);

        const ok = await post(body, await sign(body));
        expect(ok.status).toBe(200);
        expect(await ok.json()).toMatchObject({ received: true, applied: 'viewer_count' });
        const [row] = await ctx.db.select().from(shows).where(eq(shows.id, show.id));
        expect(row.viewerCount).toBe(7);
        expect(row.peakViewers).toBe(7);
    });
});
