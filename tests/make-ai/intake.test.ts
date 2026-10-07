/**
 * Make AI intake: flag gating, missing key, structured-output validation, input caps,
 * rate limit, deterministic guards and the `make_ai.intent_created` event.
 * The Gemini provider is mocked: `@ai-sdk/google` returns an `ai/test` MockLanguageModelV4.
 */
import { eq } from 'drizzle-orm';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationIntent, MAKE_AI_MAX_INPUT_CHARS, MakeAiIntakeResponse } from '@/contracts/make-ai';
import { domainEvents, makeIntents } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { MAX_JSON_BODY_BYTES } from '@/server/http';
import { clientIp, createIntent, FixedWindowRateLimiter, MakeAiRateLimiter, makeAiRateLimiter, MAKE_AI_SYSTEM_PROMPT, normalizeIntent } from '@/server/make-ai';
import { POST as intake } from '@/app/api/make-ai/intake/route';
import { useTestDb } from '../support/db';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const mock = vi.hoisted(() => ({
    text: '' as string,
    error: null as Error | null,
    providerCalls: [] as { apiKey?: string; modelId: string }[],
}));

function textResult(text: string): GenerateResult {
    return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'STOP' },
        usage: {
            inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 400, text: 400, reasoning: 0 },
        },
        warnings: [],
    };
}

const model = new MockLanguageModelV4({
    provider: 'google.generative-ai',
    modelId: 'gemini-test-flash',
    doGenerate: async () => {
        if (mock.error) throw mock.error;
        return textResult(mock.text);
    },
});

vi.mock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: (settings: { apiKey?: string } = {}) => (modelId: string) => {
        mock.providerCalls.push({ apiKey: settings.apiKey, modelId });
        return model;
    },
}));

const RPI_INTENT: CreationIntent = {
    intent: 'create',
    product_type: 'outdoor electronics enclosure',
    summary: 'A weatherproof bent-aluminum enclosure for a Raspberry Pi and a solar battery pack.',
    requirements: [
        { id: 'R1', text: 'Houses a Raspberry Pi 4 and a solar battery pack', category: 'function', source: 'user', confidence: 0.95 },
        { id: 'R2', text: 'Survives outdoor rain and sun', category: 'environment', source: 'user', confidence: 0.9 },
        { id: 'R3', text: 'Enclosure is about 200 x 150 x 80 mm', category: 'dimension', source: 'inferred', confidence: 0.4 },
    ],
    constraints: ['Must be weatherproof'],
    unknowns: [{ question: 'How many enclosures do you need?', why_it_matters: 'Quantity changes setup cost per unit.', suggested_default: '1' }],
    materials_suggested: [{ material: 'Aluminum 5052-H32', why: 'Bends cleanly and resists corrosion outdoors.' }],
    processes_suggested: ['Fiber laser cutting', 'Press brake bending', 'Powder coat'],
    risk_class: 'elevated',
    required_specialists: ['Electrical engineer'],
    refusal_note: '',
};

const BASE = 'http://localhost:3100';
const noParams = { params: Promise.resolve({}) };
let ipCounter = 0;

function post(body: unknown, headers: Record<string, string> = {}) {
    return new Request(`${BASE}/api/make-ai/intake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${++ipCounter % 250}`, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

function setEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    resetEnvCache();
}

const ENABLED = { MAKE_AI_ENABLED: 'true', GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key', MAKE_AI_MODEL: 'gemini-test-flash' };

describe('Make AI intake', () => {
    const ctx = useTestDb();

    beforeEach(() => {
        mock.text = JSON.stringify(RPI_INTENT);
        mock.error = null;
        mock.providerCalls.length = 0;
        model.doGenerateCalls.length = 0;
        makeAiRateLimiter.reset();
        setEnv(ENABLED);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        setEnv({ MAKE_AI_ENABLED: undefined, GOOGLE_GENERATIVE_AI_API_KEY: undefined, MAKE_AI_MODEL: undefined });
        vi.restoreAllMocks();
    });

    it('answers 404 when MAKE_AI_ENABLED is not "true", without calling the model', async () => {
        for (const flag of [undefined, 'false', '1', 'yes']) {
            setEnv({ MAKE_AI_ENABLED: flag });
            const res = await intake(post({ text: 'A small steel bracket' }), noParams);
            expect(res.status).toBe(404);
        }
        expect(model.doGenerateCalls).toHaveLength(0);
    });

    it('answers 503 when GOOGLE_GENERATIVE_AI_API_KEY is missing', async () => {
        setEnv({ GOOGLE_GENERATIVE_AI_API_KEY: undefined });
        const res = await intake(post({ text: 'A small steel bracket' }), noParams);
        expect(res.status).toBe(503);
        expect((await res.json()).error.message).toMatch(/not configured/i);
        setEnv({ GOOGLE_GENERATIVE_AI_API_KEY: '   ' });
        expect((await intake(post({ text: 'A small steel bracket' }), noParams)).status).toBe(503);
        expect(model.doGenerateCalls).toHaveLength(0);
    });

    it('returns a validated CreationIntent and emits make_ai.intent_created without the raw prompt', async () => {
        const text = 'Make me a weatherproof outdoor enclosure for a Raspberry Pi with a solar battery. Email me at jane@example.com';
        const res = await intake(post({ text }), noParams);
        expect(res.status).toBe(200);
        const body = MakeAiIntakeResponse.parse(await res.json());
        expect(body.estimateOnly).toBe(true);
        expect(body.model).toBe('gemini-test-flash');
        expect(body.intent.product_type).toBe('outdoor electronics enclosure');
        expect(body.intent.refusal_note).toBeUndefined();

        // Provider built from env only, with the env key and model id.
        expect(mock.providerCalls).toEqual([{ apiKey: 'test-google-key', modelId: 'gemini-test-flash' }]);
        // Structured output: JSON response format with the CreationIntent schema, system prompt + quoted buyer text.
        const call = model.doGenerateCalls[0]!;
        expect(call.responseFormat?.type).toBe('json');
        expect(JSON.stringify(call.responseFormat)).toContain('required_specialists');
        expect(JSON.stringify(call.prompt)).toContain('Raspberry Pi');
        expect(call.prompt[0]).toMatchObject({ role: 'system', content: MAKE_AI_SYSTEM_PROMPT });

        // The invented 200 x 150 x 80 mm dimension became a question, not a requirement.
        expect(body.intent.requirements.map((r) => r.id)).toEqual(['R1', 'R2']);
        expect(body.intent.requirements.some((r) => r.category === 'dimension')).toBe(false);
        expect(body.intent.unknowns[0]!.question).toContain('200 x 150 x 80 mm');
        expect(body.intent.unknowns[0]!.suggested_default).toBeUndefined();

        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.correlationId, body.intentId));
        expect(events).toHaveLength(1);
        const [event] = events;
        expect(event!.eventType).toBe('make_ai.intent_created');
        expect(event!.actorId).toBe('buyer:anonymous');
        expect(event!.payload).toMatchObject({ intentId: body.intentId, intent: 'create', riskClass: 'elevated', requirementCount: 2, refused: false, model: 'gemini-test-flash', promptChars: text.length });
        const stored = JSON.stringify(event);
        expect(stored).not.toContain('jane@example.com');
        expect(stored).not.toContain('Raspberry Pi with a solar battery');
        expect(stored).not.toContain('203.0.113.');

        // The intent is persisted under the same id (for "Continue to Build"), again without the raw prompt.
        const [row] = await ctx.db.select().from(makeIntents).where(eq(makeIntents.id, body.intentId));
        expect(row).toMatchObject({ model: 'gemini-test-flash', promptChars: text.length, buildId: null });
        expect(row!.promptSha256).toBe((event!.payload as { promptSha256: string }).promptSha256);
        expect(row!.intent).toEqual(body.intent);
        const persisted = JSON.stringify(row);
        expect(persisted).not.toContain('jane@example.com');
        expect(persisted).not.toContain('203.0.113.');
    });

    it('persists refused (regulated) intents too, with their refusal note', async () => {
        mock.text = JSON.stringify({ ...RPI_INTENT, risk_class: 'regulated', refusal_note: 'DiscoverMake does not make weapon parts.' });
        const res = await intake(post({ text: 'A suppressor baffle' }), noParams);
        expect(res.status).toBe(200);
        const body = MakeAiIntakeResponse.parse(await res.json());
        const [row] = await ctx.db.select().from(makeIntents).where(eq(makeIntents.id, body.intentId));
        expect(row!.intent).toMatchObject({ risk_class: 'regulated', refusal_note: 'DiscoverMake does not make weapon parts.', requirements: [] });
    });

    it('rejects model output that does not match the CreationIntent schema (502)', async () => {
        const before = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'make_ai.intent_created'))).length;
        const bad = [
            JSON.stringify({ ...RPI_INTENT, risk_class: 'banana' }),
            JSON.stringify({ ...RPI_INTENT, requirements: [{ ...RPI_INTENT.requirements[0], confidence: 7 }] }),
            JSON.stringify({ intent: 'create', product_type: 'bracket' }),
            'Sure! Here is your enclosure plan: ...',
        ];
        for (const text of bad) {
            mock.text = text;
            const res = await intake(post({ text: 'A small steel bracket' }), noParams);
            expect(res.status).toBe(502);
            expect((await res.json()).error.message).toMatch(/could not turn that into a plan/i);
        }
        const after = (await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'make_ai.intent_created'))).length;
        expect(after).toBe(before); // no event for a rejected answer
        expect((await ctx.db.select().from(makeIntents)).length).toBe(before); // and no persisted intent
    });

    it('maps provider failures to 502 without leaking the provider error', async () => {
        mock.error = new Error('upstream exploded: key=test-google-key');
        const res = await intake(post({ text: 'A small steel bracket' }), noParams);
        expect(res.status).toBe(502);
        expect(JSON.stringify(await res.json())).not.toContain('test-google-key');
    });

    it('caps the description at 2,000 characters and validates the body', async () => {
        const tooLong = 'a'.repeat(MAKE_AI_MAX_INPUT_CHARS + 1);
        expect((await intake(post({ text: tooLong }), noParams)).status).toBe(400);
        expect((await intake(post({ text: '  ' }), noParams)).status).toBe(400);
        expect((await intake(post({ prompt: 'wrong field' }), noParams)).status).toBe(400);
        expect((await intake(post('{not json'), noParams)).status).toBe(400);
        expect((await intake(post({ text: 'x'.repeat(MAX_JSON_BODY_BYTES + 10) }), noParams)).status).toBe(413);
        // Exactly at the cap is fine (surrounding whitespace is trimmed first).
        expect((await intake(post({ text: ` ${'a'.repeat(MAKE_AI_MAX_INPUT_CHARS)} ` }), noParams)).status).toBe(200);
        expect(model.doGenerateCalls).toHaveLength(1);
        // The server module enforces the same cap when called directly.
        await expect(createIntent(tooLong)).rejects.toMatchObject({ status: 400 });
    });

    it('rate limits each IP to 10 requests per minute with Retry-After', async () => {
        // The proxy appends the real client IP last; whatever the client prepends is ignored,
        // so rotating a spoofed first entry does not buy more requests.
        const ip = (spoof: number) => ({ 'x-forwarded-for': `10.9.9.${spoof}, 198.51.100.7` });
        for (let i = 0; i < 10; i++) expect((await intake(post({ text: 'A small steel bracket' }, ip(i)), noParams)).status).toBe(200);
        const limited = await intake(post({ text: 'A small steel bracket' }, ip(99)), noParams);
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
        expect((await limited.json()).error.code).toBe('RATE_LIMITED');
        expect(model.doGenerateCalls).toHaveLength(10);
        // Another client is unaffected.
        expect((await intake(post({ text: 'A small steel bracket' }, { 'x-forwarded-for': '198.51.100.8' }), noParams)).status).toBe(200);
    });
});

describe('MakeAiRateLimiter', () => {
    it('caps the whole instance even when every request comes from a new IP', () => {
        const rl = new MakeAiRateLimiter(new FixedWindowRateLimiter(10, 60_000), new FixedWindowRateLimiter(3, 60_000));
        expect([1, 2, 3].map((i) => rl.hit(`203.0.113.${i}`, 0).allowed)).toEqual([true, true, true]);
        expect(rl.hit('203.0.113.4', 0)).toEqual({ allowed: false, retryAfterSeconds: 60 });
        expect(rl.hit('203.0.113.4', 60_000).allowed).toBe(true);
    });

    it('reads the client IP from platform headers, else the rightmost x-forwarded-for entry', () => {
        const r = (h: Record<string, string>) => new Request('http://localhost/x', { headers: h });
        expect(clientIp(r({ 'x-forwarded-for': '1.1.1.1, 198.51.100.9' }))).toBe('198.51.100.9');
        expect(clientIp(r({ 'x-real-ip': '198.51.100.10', 'x-forwarded-for': '1.1.1.1' }))).toBe('198.51.100.10');
        expect(clientIp(r({ 'x-vercel-forwarded-for': '198.51.100.11', 'x-real-ip': '1.1.1.1' }))).toBe('198.51.100.11');
        expect(clientIp(r({}))).toBe('unknown');
    });
});

describe('FixedWindowRateLimiter', () => {
    it('resets after the window', () => {
        const rl = new FixedWindowRateLimiter(2, 1000);
        expect(rl.hit('a', 0).allowed).toBe(true);
        expect(rl.hit('a', 10).allowed).toBe(true);
        expect(rl.hit('a', 20)).toEqual({ allowed: false, retryAfterSeconds: 1 });
        expect(rl.hit('a', 1000).allowed).toBe(true);
    });
});

describe('normalizeIntent', () => {
    it('keeps buyer-stated dimensions and does not add a size question', () => {
        const out = normalizeIntent({
            ...RPI_INTENT,
            requirements: [{ id: 'X', text: 'Outer size 120 x 80 x 40 mm', category: 'dimension', source: 'user', confidence: 1 }],
            unknowns: [],
        });
        expect(out.requirements).toEqual([{ id: 'R1', text: 'Outer size 120 x 80 x 40 mm', category: 'dimension', source: 'user', confidence: 1 }]);
        expect(out.unknowns).toEqual([]);
    });

    it('adds an overall-dimensions question when the buyer gave no size and the model did not ask', () => {
        const out = normalizeIntent({ ...RPI_INTENT, requirements: [RPI_INTENT.requirements[0]!], unknowns: Array.from({ length: 12 }, (_, i) => ({ question: `Colour preference ${i}?`, why_it_matters: 'Finish.' })) });
        expect(out.unknowns).toHaveLength(12);
        expect(out.unknowns[0]!.question).toMatch(/overall dimensions/i);
    });

    it('strips manufacturing guidance from regulated requests and always carries a refusal note', () => {
        const out = normalizeIntent({ ...RPI_INTENT, risk_class: 'regulated', refusal_note: ' ' });
        expect(out.refusal_note).toMatch(/does not make regulated items/);
        expect(out.requirements).toEqual([]);
        expect(out.unknowns).toEqual([]);
        expect(out.materials_suggested).toEqual([]);
        expect(out.processes_suggested).toEqual([]);
        expect(out.constraints).toEqual([]);
        expect(out.required_specialists).toEqual([]);
    });
});
