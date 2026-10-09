/**
 * Ask Make AI (300-3) route: honest unavailable state (Make AI off / no key) with the manual
 * requirement path still working; asks never write; a proposal becomes a NEW design version only
 * when the buyer confirms it; proposals that carry numbers the buyer never typed are dropped.
 */
import { eq } from 'drizzle-orm';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildGraphView } from '@/contracts/build-graph';
import { AssistantAskResponse, AssistantStatus } from '@/contracts/workspace';
import { buildGraphWriteLimiter, getGraph } from '@/server/build-graph';
import { builds } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai';
import { guardAssistantOutput, type AssistantModelOutput } from '@/server/workspace/assistant';
import { assistantAskLimiter } from '@/server/workspace/request';
import { GET as statusRoute, POST as assistantRoute } from '@/app/api/builds/[buildId]/assistant/route';
import { BRACKET_INTENT, ENCLOSURE_INTENT, insertIntent, textResult } from '../build-graph/fixtures';
import { useTestDb as withTestDb } from '../support/db';

const mock = vi.hoisted(() => ({ output: null as unknown, raw: null as string | null }));
const model = new MockLanguageModelV4({
    provider: 'google.generative-ai',
    modelId: 'gemini-test-flash',
    doGenerate: async () => textResult(mock.raw ?? JSON.stringify(mock.output)),
});
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => () => model }));

function setEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    resetEnvCache();
}

const BASE = 'http://localhost:3100';
let ip = 0;
const post = (buildId: string, body: unknown, fixedIp?: string) =>
    new Request(`${BASE}/api/builds/${buildId}/assistant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': fixedIp ?? `198.51.100.${++ip % 250}` },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
const params = (buildId: string) => ({ params: Promise.resolve({ buildId }) });

const out = (o: Partial<AssistantModelOutput>): AssistantModelOutput => ({ answer: 'Noted.', proposal_kind: 'none', cited_node_keys: [], ...o });

async function latest(buildId: string) {
    const [b] = await ctx.db.select({ v: builds.currentVersion }).from(builds).where(eq(builds.id, buildId));
    return b!.v;
}

const ctx = withTestDb({ seed: true });
let bracketId = '';
let enclosureId = '';

beforeAll(async () => {
    setEnv({ MAKE_AI_ENABLED: 'false', GOOGLE_GENERATIVE_AI_API_KEY: undefined });
    bracketId = (await createBuildFromIntent(await insertIntent(ctx.db, BRACKET_INTENT))).buildId;
    enclosureId = (await createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT))).buildId;
});
beforeEach(() => {
    assistantAskLimiter.reset();
    buildGraphWriteLimiter.reset();
    mock.output = null;
    mock.raw = null;
    model.doGenerateCalls.length = 0;
});
afterEach(() => setEnv({ MAKE_AI_ENABLED: 'false', GOOGLE_GENERATIVE_AI_API_KEY: undefined }));

describe('Make AI unavailable', () => {
    it('says so honestly and still lets the buyer add a requirement', async () => {
        const status = AssistantStatus.parse(await (await statusRoute(new Request(`${BASE}/api/builds/${bracketId}/assistant`), params(bracketId))).json());
        expect(status).toMatchObject({ available: false, version: 1 });
        expect(status.reason).toMatch(/switched off/);

        setEnv({ MAKE_AI_ENABLED: 'true', GOOGLE_GENERATIVE_AI_API_KEY: undefined });
        const noKey = AssistantStatus.parse(await (await statusRoute(new Request(`${BASE}/api/builds/${bracketId}/assistant`), params(bracketId))).json());
        expect(noKey.reason).toMatch(/not connected to a model/);

        const ask = await assistantRoute(post(bracketId, { action: 'ask', message: 'What material for outdoor use?' }), params(bracketId));
        expect(ask.status).toBe(200);
        expect(AssistantAskResponse.parse(await ask.json())).toMatchObject({ status: 'unavailable', version: 1 });
        expect(model.doGenerateCalls).toHaveLength(0);

        const v = await latest(bracketId);
        const added = await assistantRoute(post(bracketId, { action: 'add_requirement', basedOnVersion: v, text: 'Fits a 120 mm fan', category: 'dimension' }), params(bracketId));
        expect(added.status).toBe(201);
        const view = BuildGraphView.parse(await added.json());
        expect(view.version.version).toBe(v + 1);
        const req = view.nodes.find((n) => n.key === 'req:buyer_1')!;
        expect(req).toMatchObject({ type: 'REQUIREMENT', source: 'user', confidence: null, provenance: 'workspace:buyer' });
        expect(req.data).toMatchObject({ text: 'Fits a 120 mm fan', category: 'dimension', requirementSource: 'user' });
        expect(view.edges.some((e) => e.type === 'CONSTRAINED_BY' && e.fromKey === 'build:root' && e.toKey === 'req:buyer_1')).toBe(true);
        expect(view.version.summary).toBe('Added a requirement: Fits a 120 mm fan');
    });

    it('validates the body: action, length, size cap', async () => {
        expect((await assistantRoute(post(bracketId, { action: 'delete_everything' }), params(bracketId))).status).toBe(400);
        expect((await assistantRoute(post(bracketId, { action: 'ask', message: 'x'.repeat(1001) }), params(bracketId))).status).toBe(400);
        expect((await assistantRoute(post(bracketId, JSON.stringify({ action: 'ask', message: 'hi', pad: 'x'.repeat(20_000) })), params(bracketId))).status).toBe(413);
        expect((await assistantRoute(post('bld_missing', { action: 'ask', message: 'hello there' }), params('bld_missing'))).status).toBe(404);
    });
});

describe('Make AI available', () => {
    beforeEach(() => setEnv({ MAKE_AI_ENABLED: 'true', GOOGLE_GENERATIVE_AI_API_KEY: 'test-key', MAKE_AI_MODEL: 'gemini-test-flash' }));

    it('turns a change request into a proposal; only confirming writes a new version', async () => {
        const before = await latest(bracketId);
        mock.output = out({
            answer: 'I can record that as a new requirement for you to confirm.',
            proposal_kind: 'add_requirement',
            requirement_text: 'Make the arm 20 mm longer than the stated 200 mm',
            requirement_category: 'dimension',
            cited_node_keys: ['req:R2', 'req:nope'],
        });
        const res = await assistantRoute(post(bracketId, { action: 'ask', message: 'make it 20 mm longer' }), params(bracketId));
        expect(res.status).toBe(200);
        const reply = AssistantAskResponse.parse(await res.json());
        if (reply.status !== 'answered') throw new Error('expected an answer');
        expect(reply).toMatchObject({ version: before, guardNote: null, model: 'gemini-test-flash', estimateOnly: true });
        expect(reply.proposal).toEqual({ kind: 'add_requirement', text: 'Make the arm 20 mm longer than the stated 200 mm', category: 'dimension' });
        expect(reply.citedKeys).toEqual(['req:R2']);
        // The prompt is grounded on the graph and treats the message as data.
        const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
        expect(prompt).toContain('req:R2');
        expect(prompt).toContain('make it 20 mm longer');
        // Asking wrote nothing.
        expect(await latest(bracketId)).toBe(before);

        const confirmed = await assistantRoute(post(bracketId, { action: 'confirm', basedOnVersion: reply.version, proposal: reply.proposal }), params(bracketId));
        expect(confirmed.status).toBe(201);
        const view = BuildGraphView.parse(await confirmed.json());
        expect(view.version.version).toBe(before + 1);
        expect(view.version.summary).toMatch(/^Confirmed a Make AI change: /);
        const added = view.nodes.find((n) => n.provenance === 'make-ai-assistant:confirmed')!;
        expect(added).toMatchObject({ type: 'REQUIREMENT', source: 'user' });
        expect(added.data.text).toBe('Make the arm 20 mm longer than the stated 200 mm');

        // The same proposal again is stale now.
        const stale = await assistantRoute(post(bracketId, { action: 'confirm', basedOnVersion: reply.version, proposal: reply.proposal }), params(bracketId));
        expect(stale.status).toBe(409);
        expect(await latest(bracketId)).toBe(before + 1);
    });

    it('never invents numbers: a proposal with a number the buyer did not give is dropped', async () => {
        const before = await latest(bracketId);
        mock.output = out({ answer: 'A 220 mm arm would work.', proposal_kind: 'add_requirement', requirement_text: 'Arm length 220 mm', requirement_category: 'dimension' });
        const reply = AssistantAskResponse.parse(await (await assistantRoute(post(bracketId, { action: 'ask', message: 'make it 20 mm longer' }), params(bracketId))).json());
        if (reply.status !== 'answered') throw new Error('expected an answer');
        expect(reply.proposal).toBeNull();
        expect(reply.guardNote).toMatch(/did not give/);
        expect(await latest(bracketId)).toBe(before);
    });

    it('answers an open question only with the buyer’s own value', async () => {
        const v = await latest(enclosureId);
        mock.output = out({ proposal_kind: 'answer_question', unknown_key: 'unk:U2', value: '2', cited_node_keys: ['unk:U2'] });
        const reply = AssistantAskResponse.parse(await (await assistantRoute(post(enclosureId, { action: 'ask', message: 'We need 2 of these' }), params(enclosureId))).json());
        if (reply.status !== 'answered') throw new Error('expected an answer');
        expect(reply.proposal).toMatchObject({ kind: 'answer_question', unknownKey: 'unk:U2', value: '2' });
        expect(await latest(enclosureId)).toBe(v);

        // A different number than the buyer said is refused.
        mock.output = out({ proposal_kind: 'answer_question', unknown_key: 'unk:U2', value: '3' });
        const wrong = AssistantAskResponse.parse(await (await assistantRoute(post(enclosureId, { action: 'ask', message: 'We need 2 of these' }), params(enclosureId))).json());
        expect(wrong.status === 'answered' && wrong.proposal).toBeNull();

        // A question that does not exist is ignored.
        mock.output = out({ proposal_kind: 'answer_question', unknown_key: 'unk:ZZ', value: '2' });
        const ghost = AssistantAskResponse.parse(await (await assistantRoute(post(enclosureId, { action: 'ask', message: 'We need 2 of these' }), params(enclosureId))).json());
        expect(ghost.status === 'answered' && ghost.proposal).toBeNull();

        const confirmed = await assistantRoute(post(enclosureId, { action: 'confirm', basedOnVersion: reply.version, proposal: reply.proposal }), params(enclosureId));
        expect(confirmed.status).toBe(201);
        const view = BuildGraphView.parse(await confirmed.json());
        expect(view.version.version).toBe(v + 1);
        expect(view.nodes.find((n) => n.key === 'unk:U2')!.data).toMatchObject({ status: 'answered', answer: '2' });
    });

    it('reports a malformed model answer as 502 and rate-limits asks per IP', async () => {
        mock.raw = '{"not":"the schema"}';
        expect((await assistantRoute(post(bracketId, { action: 'ask', message: 'What finish?' }), params(bracketId))).status).toBe(502);

        mock.raw = null;
        mock.output = out({ answer: 'Powder coat suits outdoor use.' });
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) statuses.push((await assistantRoute(post(bracketId, { action: 'ask', message: 'What finish?' }, '203.0.113.77'), params(bracketId))).status);
        expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
        expect(statuses[10]).toBe(429);
    });
});

describe('guardAssistantOutput (pure)', () => {
    it('keeps numbers from the message and from buyer-stated nodes, drops anything else', async () => {
        const view = (await getGraph(bracketId))!;
        const ok = guardAssistantOutput(out({ proposal_kind: 'add_requirement', requirement_text: '3 mm thick, 200 mm arm, plus 15 mm', requirement_category: 'dimension' }), view, 'add 15 mm');
        expect(ok.proposal).not.toBeNull();
        const bad = guardAssistantOutput(out({ proposal_kind: 'add_requirement', requirement_text: '4 mm thick' }), view, 'thicker please');
        expect(bad.proposal).toBeNull();
        expect(bad.guardNote).not.toBeNull();
        expect(guardAssistantOutput(out({ proposal_kind: 'add_requirement', requirement_text: 'Matte black finish' }), view, 'black please').proposal).toEqual({ kind: 'add_requirement', text: 'Matte black finish', category: 'other' });
        expect(guardAssistantOutput(out({ proposal_kind: 'add_requirement', requirement_text: 'x' }), view, 'x').proposal).toBeNull();
    });
});
