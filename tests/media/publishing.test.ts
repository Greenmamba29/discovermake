/**
 * Publishing + remix licences against a real database: who may publish, what private /
 * public means, licence enforcement on remix / clone (R2 routes and Make This), the
 * personal-remix publishing block, and Make This copying the flat pattern into an orderable build.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as publishRoute } from '@/app/api/media/builds/[buildId]/publish/route';
import { GET as buildRoute } from '@/app/api/media/builds/[buildId]/route';
import { POST as makeRoute } from '@/app/api/media/builds/[buildId]/make/route';
import { POST as remixRoute } from '@/app/api/builds/[buildId]/remix/route';
import { builds, domainEvents, parts } from '@/server/db/schema';
import { assertCanFork, publicBuildView } from '@/server/media';
import { getStorage } from '@/server/storage';
import { sampleBracketDxf } from '@/lib/sample-dxf';
import { useTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { makeUser, req, viewerOf } from '../live/fixtures';
import { creatorBuild, derivedBuild, publish } from './fixtures';

vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async () => null }));

const params = (buildId: string) => ({ params: Promise.resolve({ buildId }) });

describe('publishing and remix licences', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    it('only the signed-in owner can publish; private builds are 404 to everyone else', async () => {
        const { creator, viewer, fixture } = await creatorBuild(ctx.db);
        const stranger = await makeUser('stranger');
        const buildId = fixture.build.id;

        const anon = await publishRoute(req(`/api/media/builds/${buildId}/publish`, { body: { visibility: 'public' } }), params(buildId));
        expect(anon.status).toBe(401);
        const foreign = await publishRoute(req(`/api/media/builds/${buildId}/publish`, { user: stranger, body: { visibility: 'public' } }), params(buildId));
        expect(foreign.status).toBe(403);

        const ok = await publishRoute(req(`/api/media/builds/${buildId}/publish`, { user: creator, body: { visibility: 'public', license: 'commercial', royaltyPct: 12, tags: ['lighting', 'desk-setup', 'walnut'], title: 'Walnut desk lamp' } }), params(buildId));
        expect(ok.status).toBe(200);
        const pub = await ok.json();
        expect(pub).toMatchObject({ visibility: 'public', license: 'commercial', royaltyPct: 12, title: 'Walnut desk lamp', interests: ['lighting', 'desk-setup'] });
        expect(pub.publishedAt).toBeTruthy();
        const [event] = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'build.published'));
        expect(event.buildId).toBe(buildId);

        // Public: anyone (signed out too) sees the build page.
        const publicRes = await buildRoute(req(`/api/media/builds/${buildId}`), params(buildId));
        expect(publicRes.status).toBe(200);
        const view = await publicRes.json();
        expect(view.card).toMatchObject({ title: 'Walnut desk lamp', license: 'commercial', royaltyPct: 12, orderable: true });
        expect(view.quote.quoteId).toBe(fixture.quote.id);

        // Private again: 404 to strangers and signed-out viewers, still visible to the owner.
        await publish(viewer, buildId, { visibility: 'private' });
        expect((await buildRoute(req(`/api/media/builds/${buildId}`), params(buildId))).status).toBe(404);
        expect((await buildRoute(req(`/api/media/builds/${buildId}`, { user: stranger }), params(buildId))).status).toBe(404);
        expect((await buildRoute(req(`/api/media/builds/${buildId}`, { user: creator }), params(buildId))).status).toBe(200);
        expect(await publicBuildView(buildId, await viewerOf(stranger))).toBeNull();
        // Royalty bounds come from the contract.
        const tooHigh = await publishRoute(req(`/api/media/builds/${buildId}/publish`, { user: creator, body: { visibility: 'public', royaltyPct: 31 } }), params(buildId));
        expect(tooHigh.status).toBe(400);
    });

    it('enforces the licence: no remix when "none", remix allowed for personal and commercial, Make This always', async () => {
        const remixer = await makeUser('remixer');
        const remixerCtx = await viewerOf(remixer);
        const none = await creatorBuild(ctx.db);
        await publish(none.viewer, none.fixture.build.id, { license: 'none' });
        await expect(assertCanFork(none.fixture.build.id, 'remix', remixerCtx)).rejects.toMatchObject({ status: 403 });
        await expect(assertCanFork(none.fixture.build.id, 'clone', remixerCtx)).resolves.toMatchObject({ license: 'none' });
        // The owner may still remix their own design.
        await expect(assertCanFork(none.fixture.build.id, 'remix', none.viewer)).resolves.toBeTruthy();
        // The R2 remix route applies the same gate.
        const blocked = await remixRoute(req(`/api/builds/${none.fixture.build.id}/remix`, { user: remixer, body: {} }), params(none.fixture.build.id));
        expect(blocked.status).toBe(403);
        expect((await blocked.json()).error.details).toMatchObject({ reason: 'LICENSE' });

        for (const license of ['personal', 'commercial'] as const) {
            const c = await creatorBuild(ctx.db);
            await publish(c.viewer, c.fixture.build.id, { license });
            await expect(assertCanFork(c.fixture.build.id, 'remix', remixerCtx)).resolves.toMatchObject({ license });
        }
    });

    it('a personal remix can be ordered but not published; a commercial remix can be published', async () => {
        const remixer = await makeUser('remixer', ['buyer', 'creator']);
        const remixerCtx = await viewerOf(remixer);
        const personal = await creatorBuild(ctx.db);
        await publish(personal.viewer, personal.fixture.build.id, { license: 'personal' });
        const pRemix = await derivedBuild(ctx.db, personal.fixture.build.id, 'remix', remixer.id);
        await expect(publish(remixerCtx, pRemix.build.id, { visibility: 'public' })).rejects.toMatchObject({ status: 403 });
        await expect(publish(remixerCtx, pRemix.build.id, { visibility: 'private' })).resolves.toMatchObject({ visibility: 'private' });

        const commercial = await creatorBuild(ctx.db);
        await publish(commercial.viewer, commercial.fixture.build.id, { license: 'commercial' });
        const cRemix = await derivedBuild(ctx.db, commercial.fixture.build.id, 'remix', remixer.id);
        await expect(publish(remixerCtx, cRemix.build.id, { visibility: 'public', license: 'personal' })).resolves.toMatchObject({ visibility: 'public' });
        const tree = (await publicBuildView(commercial.fixture.build.id, null))!.remixTree;
        expect(tree.children.map((c) => c.buildId)).toContain(cRemix.build.id);
    });

    it('Make This copies the flat pattern into a new orderable build derived from the published one', async () => {
        const { viewer, fixture } = await creatorBuild(ctx.db);
        await getStorage().putObject(fixture.part.fileKey, sampleBracketDxf(), { contentType: 'application/dxf' });
        await publish(viewer, fixture.build.id, { license: 'none' });
        const buyer = await makeUser('maker');

        const remix = await makeRoute(req(`/api/media/builds/${fixture.build.id}/make`, { user: buyer, body: { kind: 'remix' } }), params(fixture.build.id));
        expect(remix.status).toBe(403);

        const res = await makeRoute(req(`/api/media/builds/${fixture.build.id}/make`, { user: buyer, body: { kind: 'clone', via: 'clp_test000000000000000' } }), params(fixture.build.id));
        expect(res.status).toBe(201);
        const made = await res.json();
        expect(made).toMatchObject({ derivedFromBuildId: fixture.build.id, license: 'none', royaltyPct: 10 });
        expect(made.nextUrl).toBe(`/parts/${made.partId}`);
        const [b] = await ctx.db.select().from(builds).where(eq(builds.id, made.buildId));
        expect(b).toMatchObject({ origin: 'clone', derivedFromBuildId: fixture.build.id, ownerUserId: buyer.id });
        const [p] = await ctx.db.select().from(parts).where(eq(parts.id, made.partId));
        expect(p).toMatchObject({ buildId: made.buildId, status: 'READY' });
    });
});
