/**
 * Build ownership (ADR-0009):
 *   1. the assertCanEditBuild decision matrix;
 *   2. every build-mutating route answers 403 to another user / another device and
 *      succeeds for the owner;
 *   3. builds created through the API are stamped with the creator (user and/or device).
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BuildForkResponse } from '@/contracts/build-graph';
import { CreatePartResponse } from '@/contracts';
import { buildGraphWriteLimiter } from '@/server/build-graph';
import { builds, users } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai';
import { assertCanEditBuild, type BuildOwnership } from '@/server/auth/viewer';
import { POST as answersRoute } from '@/app/api/builds/[buildId]/answers/route';
import { POST as approveRoute } from '@/app/api/builds/[buildId]/versions/[version]/approve/route';
import { POST as cadRoute } from '@/app/api/builds/[buildId]/cad/route';
import { POST as sourcingRoute } from '@/app/api/builds/[buildId]/sourcing/route';
import { POST as selectOfferRoute } from '@/app/api/builds/[buildId]/sourcing/offers/[offerId]/select/route';
import { POST as remixRoute } from '@/app/api/builds/[buildId]/remix/route';
import { POST as cloneRoute } from '@/app/api/builds/[buildId]/clone/route';
import { POST as partsRoute } from '@/app/api/parts/route';
import { POST as uploadRoute } from '@/app/api/parts/[partId]/upload/route';
import { POST as analyzeRoute } from '@/app/api/parts/[partId]/analyze/route';
import { POST as reorderRoute } from '@/app/api/me/builds/[buildId]/reorder/route';
import { sampleBracketDxf } from '@/lib/sample-dxf';
import { ENCLOSURE_INTENT, insertIntent } from '../build-graph/fixtures';
import { useTestDb } from '../support/db';
import { analyzedPart, placedOrder, useLocalStorage } from './fixtures';
import { newDevice, params, req, setCookieValue, signedInUser, type Principal } from './helpers';

describe('build ownership', () => {
    const ctx = useTestDb({ seed: true });
    useLocalStorage();
    beforeAll(() => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        delete process.env.CAD_WORKER_URL;
        resetEnvCache();
    });
    beforeEach(() => buildGraphWriteLimiter.reset());

    const check = (p: Principal | null, build: BuildOwnership, extra: Record<string, string> = {}) => assertCanEditBuild(req('POST', '/x', p, undefined, extra), build);

    it('assertCanEditBuild: the decision matrix', async () => {
        const alice = await signedInUser();
        const bob = await signedInUser();
        const guest = newDevice();
        const stranger = newDevice();
        const [opsUser] = await ctx.db.insert(users).values({ email: 'ops-matrix@example.com', roles: ['buyer', 'ops'] }).returning();
        const { createSession } = await import('@/server/auth/sessions');
        const ops: Principal = { ...newDevice(), session: (await createSession(opsUser.id)).secret };

        const owned: BuildOwnership = { id: 'bld_owned', ownerUserId: alice.userId!, deviceHash: alice.deviceHash };
        await expect(check(alice, owned)).resolves.toBeUndefined();
        await expect(check(bob, owned)).rejects.toMatchObject({ status: 403 });
        await expect(check({ device: alice.device, deviceHash: alice.deviceHash }, owned)).rejects.toMatchObject({ status: 403 }); // same device, signed out
        await expect(check(stranger, owned)).rejects.toMatchObject({ status: 403 });
        await expect(check(null, owned)).rejects.toMatchObject({ status: 403 });
        await expect(check(ops, owned)).resolves.toBeUndefined();
        await expect(check(alice, owned, { origin: 'https://evil.example' })).rejects.toMatchObject({ status: 403 });

        const deviceBuild: BuildOwnership = { id: 'bld_device', ownerUserId: null, deviceHash: guest.deviceHash };
        await expect(check(guest, deviceBuild)).resolves.toBeUndefined();
        await expect(check(stranger, deviceBuild)).rejects.toMatchObject({ status: 403 });
        await expect(check(bob, deviceBuild)).rejects.toMatchObject({ status: 403 });
        await expect(check(null, deviceBuild)).rejects.toMatchObject({ status: 403 });
        await expect(check(ops, deviceBuild)).resolves.toBeUndefined();
        // Alice signed in on the guest device once; from her other device she may still edit its guest builds.
        await createSession(alice.userId!, { deviceHash: guest.deviceHash });
        await expect(check(alice, deviceBuild)).resolves.toBeUndefined();

        const legacy: BuildOwnership = { id: 'bld_legacy', ownerUserId: null, deviceHash: null };
        await expect(check(null, legacy)).resolves.toBeUndefined();
        await expect(check(stranger, legacy)).resolves.toBeUndefined();
    });

    describe('every build-mutating route: 403 for another user / another device, success for the owner', () => {
        let owner: Principal;
        let otherUser: Principal;
        let otherDevice: Principal;
        let graphBuildId = '';
        let partBuild: { buildId: string; partId: string };
        let freshPart: { buildId: string; partId: string };
        let guestOwner: Principal;

        beforeAll(async () => {
            owner = await signedInUser('owner@example.com');
            otherUser = await signedInUser('other@example.com');
            otherDevice = newDevice();
            guestOwner = newDevice();
            graphBuildId = (await createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT), { owner: { ownerUserId: owner.userId!, deviceHash: owner.deviceHash } })).buildId;
            partBuild = await analyzedPart({ deviceHash: guestOwner.deviceHash });
            await placedOrder(ctx.db, partBuild.partId, 'guest-owner@example.com');
            freshPart = await analyzedPart({ deviceHash: guestOwner.deviceHash }); // not ordered: still editable
        });

        type Case = { name: string; call: (p: Principal) => Promise<Response>; ok: number; owner: () => Principal; strangers: () => Principal[] };
        const graphStrangers = () => [otherUser, otherDevice, { device: owner.device, deviceHash: owner.deviceHash }];
        const partStrangers = () => [otherUser, otherDevice];
        const dxf = () => sampleBracketDxf();

        const cases: Case[] = [
            { name: 'POST /api/builds/:id/answers', ok: 201, owner: () => owner, strangers: graphStrangers, call: (p) => answersRoute(req('POST', `/api/builds/${graphBuildId}/answers`, p, { answers: [{ unknownKey: 'unk:U2', value: '2' }] }), params({ buildId: graphBuildId })) },
            { name: 'POST /api/builds/:id/versions/:v/approve', ok: 200, owner: () => owner, strangers: graphStrangers, call: (p) => approveRoute(req('POST', `/api/builds/${graphBuildId}/versions/2/approve`, p), params({ buildId: graphBuildId, version: '2' })) },
            { name: 'POST /api/builds/:id/sourcing', ok: 201, owner: () => owner, strangers: graphStrangers, call: (p) => sourcingRoute(req('POST', `/api/builds/${graphBuildId}/sourcing`, p, { quantity: 25 }), params({ buildId: graphBuildId })) },
            // No CAD worker in unit tests: the owner passes the guard and gets the "not available" 501.
            { name: 'POST /api/builds/:id/cad', ok: 501, owner: () => owner, strangers: graphStrangers, call: (p) => cadRoute(req('POST', `/api/builds/${graphBuildId}/cad`, p, {}), params({ buildId: graphBuildId })) },
            // No supplier offer exists: the owner passes the guard and gets 404 for the offer.
            { name: 'POST /api/builds/:id/sourcing/offers/:offerId/select', ok: 404, owner: () => owner, strangers: graphStrangers, call: (p) => selectOfferRoute(req('POST', `/api/builds/${graphBuildId}/sourcing/offers/off_missing0000/select`, p), params({ buildId: graphBuildId, offerId: 'off_missing0000' })) },
            { name: 'POST /api/parts/:id/upload', ok: 200, owner: () => guestOwner, strangers: partStrangers, call: (p) => uploadRoute(req('PUT', `/api/parts/${freshPart.partId}/upload`, p, dxf()), params({ partId: freshPart.partId })) },
            { name: 'POST /api/parts/:id/analyze', ok: 200, owner: () => guestOwner, strangers: partStrangers, call: (p) => analyzeRoute(req('POST', `/api/parts/${freshPart.partId}/analyze`, p), params({ partId: freshPart.partId })) },
            { name: 'POST /api/me/builds/:id/reorder', ok: 201, owner: () => guestOwner, strangers: partStrangers, call: (p) => reorderRoute(req('POST', `/api/me/builds/${partBuild.buildId}/reorder`, p), params({ buildId: partBuild.buildId })) },
        ];

        for (const c of cases) {
            it(c.name, async () => {
                for (const stranger of c.strangers()) {
                    const res = await c.call(stranger);
                    expect(res.status, `stranger got ${res.status}`).toBe(403);
                    expect((await res.json()).error.code).toBe('FORBIDDEN');
                }
                const res = await c.call(c.owner());
                expect(res.status, JSON.stringify(await res.clone().json())).toBe(c.ok);
            });
        }
    });

    it('builds created through the API belong to their creator (user and/or device); forks of others’ builds belong to the forker', async () => {
        const alice = await signedInUser();
        const dxf = sampleBracketDxf();
        const signedIn = await partsRoute(req('POST', '/api/parts', alice, { filename: 'a.dxf', sizeBytes: dxf.length }), params({}));
        expect(signedIn.status).toBe(201);
        const a = CreatePartResponse.parse(await signedIn.json());
        expect((await ctx.db.select().from(builds).where(eq(builds.id, a.buildId)))[0]).toMatchObject({ ownerUserId: alice.userId, deviceHash: alice.deviceHash });

        // A browser with no device cookie yet gets one, and the build is bound to it.
        const anon = await partsRoute(req('POST', '/api/parts', null, { filename: 'b.dxf', sizeBytes: dxf.length }), params({}));
        const minted = setCookieValue(anon, 'dm_device');
        expect(minted).toMatch(/^[A-Za-z0-9_-]{32}$/);
        const b = CreatePartResponse.parse(await anon.json());
        const { hashDeviceSecret } = await import('@/server/auth/device');
        expect((await ctx.db.select().from(builds).where(eq(builds.id, b.buildId)))[0]).toMatchObject({ ownerUserId: null, deviceHash: hashDeviceSecret(minted!) });

        // Bob remixes and clones Alice's approved build: allowed, and the copies are Bob's.
        const bob = await signedInUser();
        const source = (await createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT), { owner: { ownerUserId: alice.userId!, deviceHash: alice.deviceHash } })).buildId;
        const { approveVersion } = await import('@/server/build-graph');
        await approveVersion(source, 1);
        for (const route of [remixRoute, cloneRoute]) {
            const res = await route(req('POST', `/api/builds/${source}/x`, bob), params({ buildId: source }));
            expect(res.status).toBe(201);
            const fork = BuildForkResponse.parse(await res.json());
            expect((await ctx.db.select().from(builds).where(eq(builds.id, fork.buildId)))[0]).toMatchObject({ ownerUserId: bob.userId, deviceHash: bob.deviceHash });
        }
    });
});
