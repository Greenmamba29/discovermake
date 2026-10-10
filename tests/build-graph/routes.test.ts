/**
 * Build Graph routes: graph, diff, answers, approve, remix, clone (R1 route + error style,
 * per-IP rate limits on writes).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BuildForkResponse, BuildGraphDiff, BuildGraphView } from '@/contracts/build-graph';
import { buildGraphWriteLimiter } from '@/server/build-graph';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai';
import { GET as graphRoute } from '@/app/api/builds/[buildId]/graph/route';
import { GET as diffRoute } from '@/app/api/builds/[buildId]/graph/diff/route';
import { POST as answersRoute } from '@/app/api/builds/[buildId]/answers/route';
import { POST as approveRoute } from '@/app/api/builds/[buildId]/versions/[version]/approve/route';
import { POST as remixRoute } from '@/app/api/builds/[buildId]/remix/route';
import { POST as cloneRoute } from '@/app/api/builds/[buildId]/clone/route';
import { useTestDb } from '../support/db';
import { ENCLOSURE_INTENT, insertIntent } from './fixtures';

const BASE = 'http://localhost:3100';
let ip = 0;
const headers = () => ({ 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${++ip % 250}` });
const get = (path: string) => new Request(`${BASE}${path}`);
const post = (path: string, body?: unknown, h: Record<string, string> = headers()) =>
    new Request(`${BASE}${path}`, { method: 'POST', headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe('Build Graph routes', () => {
    const ctx = useTestDb({ seed: true });
    let buildId = '';

    beforeAll(async () => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        resetEnvCache();
        buildId = (await createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT))).buildId;
    });
    beforeEach(() => buildGraphWriteLimiter.reset());

    it('GET graph: current version, ?version=, and 404s', async () => {
        const res = await graphRoute(get(`/api/builds/${buildId}/graph`), params({ buildId }));
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const view = BuildGraphView.parse(await res.json());
        expect(view.build.id).toBe(buildId);

        expect((await graphRoute(get(`/api/builds/${buildId}/graph?version=1`), params({ buildId }))).status).toBe(200);
        expect((await graphRoute(get(`/api/builds/${buildId}/graph?version=99`), params({ buildId }))).status).toBe(404);
        expect((await graphRoute(get(`/api/builds/${buildId}/graph?version=abc`), params({ buildId }))).status).toBe(400);
        expect((await graphRoute(get('/api/builds/not-an-id/graph'), params({ buildId: 'not-an-id' }))).status).toBe(404);
        expect((await graphRoute(get('/api/builds/bld_missing/graph'), params({ buildId: 'bld_missing' }))).status).toBe(404);
    });

    it('POST answers -> new version; approve; diff; remix and clone', async () => {
        const bad = await answersRoute(post(`/api/builds/${buildId}/answers`, { answers: [] }), params({ buildId }));
        expect(bad.status).toBe(400);
        expect((await bad.json()).error.code).toBe('VALIDATION_FAILED');

        const answered = await answersRoute(post(`/api/builds/${buildId}/answers`, { answers: [{ unknownKey: 'unk:U2', value: '2' }] }), params({ buildId }));
        expect(answered.status).toBe(201);
        const v2 = BuildGraphView.parse(await answered.json());
        expect(v2.version.version).toBe(2);
        const again = await answersRoute(post(`/api/builds/${buildId}/answers`, { answers: [{ unknownKey: 'unk:U2', value: '3' }] }), params({ buildId }));
        expect(again.status).toBe(409);

        const diff = await diffRoute(get(`/api/builds/${buildId}/graph/diff?from=1&to=2`), params({ buildId }));
        expect(diff.status).toBe(200);
        expect(BuildGraphDiff.parse(await diff.json()).added).toEqual(['req:ans_U2']);
        expect((await diffRoute(get(`/api/builds/${buildId}/graph/diff?from=1`), params({ buildId }))).status).toBe(400);

        // No approved version yet: remix is refused.
        expect((await remixRoute(post(`/api/builds/${buildId}/remix`), params({ buildId }))).status).toBe(409);

        expect((await approveRoute(post(`/api/builds/${buildId}/versions/0/approve`), params({ buildId, version: '0' }))).status).toBe(404);
        expect((await approveRoute(post(`/api/builds/${buildId}/versions/9/approve`), params({ buildId, version: '9' }))).status).toBe(404);
        const approved = await approveRoute(post(`/api/builds/${buildId}/versions/2/approve`), params({ buildId, version: '2' }));
        expect(approved.status).toBe(200);
        expect(BuildGraphView.parse(await approved.json()).version.status).toBe('APPROVED');
        expect((await approveRoute(post(`/api/builds/${buildId}/versions/1/approve`), params({ buildId, version: '1' }))).status).toBe(409);

        const remix = await remixRoute(post(`/api/builds/${buildId}/remix`), params({ buildId }));
        expect(remix.status).toBe(201);
        expect(BuildForkResponse.parse(await remix.json()).derivedFromBuildId).toBe(buildId);

        const clone = await cloneRoute(post(`/api/builds/${buildId}/clone`, { name: 'Pi box for the shed' }), params({ buildId }));
        expect(clone.status).toBe(201);
        const cloned = BuildForkResponse.parse(await clone.json());
        const view = BuildGraphView.parse(await (await graphRoute(get(`/api/builds/${cloned.buildId}/graph`), params({ buildId: cloned.buildId }))).json());
        expect(view.build).toMatchObject({ name: 'Pi box for the shed', origin: 'clone' });

        expect((await cloneRoute(post(`/api/builds/${buildId}/clone`, { name: '' }), params({ buildId }))).status).toBe(400);
        expect((await cloneRoute(post(`/api/builds/${buildId}/clone`, '{nope'), params({ buildId }))).status).toBe(400);
    });

    it('rate limits writes per IP with Retry-After', async () => {
        const h = { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.200' };
        for (let i = 0; i < 30; i++) {
            const res = await answersRoute(post(`/api/builds/${buildId}/answers`, { answers: [] }, h), params({ buildId }));
            expect(res.status).toBe(400);
        }
        const limited = await remixRoute(post(`/api/builds/${buildId}/remix`, undefined, h), params({ buildId }));
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    });
});
