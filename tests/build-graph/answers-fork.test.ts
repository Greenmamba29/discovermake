/**
 * NEEDS_INPUT answers (new version per answer batch) and remix / clone lineage.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { BuildForkResponse } from '@/contracts/build-graph';
import { answerUnknowns, approveVersion, diffVersions, forkBuild, getGraph } from '@/server/build-graph';
import { bgNodes, builds, domainEvents } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai';
import { useTestDb } from '../support/db';
import { BRACKET_INTENT, ENCLOSURE_INTENT, insertIntent } from './fixtures';

describe('NEEDS_INPUT answers', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        resetEnvCache();
    });

    async function enclosureBuild() {
        return createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT));
    }

    it('writes a new version: answered unknowns, user requirements, edges, part dimensions; build -> DRAFT when nothing is open', async () => {
        const { buildId } = await enclosureBuild();
        const v1Before = await ctx.db.select().from(bgNodes).where(and(eq(bgNodes.buildId, buildId), eq(bgNodes.designVersion, 1)));

        const partial = await answerUnknowns(buildId, [{ unknownKey: 'unk:U2', value: '1' }]);
        expect(partial.version).toMatchObject({ version: 2, parentVersion: 1, status: 'DRAFT', summary: 'Answered 1 Make AI question' });
        const u2 = partial.nodes.find((n) => n.key === 'unk:U2')!;
        expect(u2.data).toMatchObject({ status: 'answered', answer: '1', usedDefault: true });
        expect(partial.nodes.find((n) => n.key === 'req:ans_U2')).toMatchObject({ type: 'REQUIREMENT', source: 'user', confidence: null, label: '1', data: { category: 'quantity', answers: 'unk:U2' } });
        let [build] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
        expect(build!.status).toBe('NEEDS_INPUT');

        const done = await answerUnknowns(buildId, [{ unknownKey: 'unk:U1', value: '220 × 160 × 90 mm, 2 mm sheet' }]);
        expect(done.version.version).toBe(3);
        expect(done.nodes.find((n) => n.key === 'part:main')!.data).toMatchObject({
            dimensions: [{ text: '220 × 160 × 90 mm, 2 mm sheet', from: 'req:ans_U1' }],
            dimensionsStatus: 'stated',
        });
        const edges = done.edges.map((e) => `${e.type} ${e.fromKey} ${e.toKey}`);
        expect(edges).toContain('CONSTRAINED_BY build:root req:ans_U1');
        expect(edges).toContain('CONSTRAINED_BY part:main req:ans_U1');
        expect(edges.some((e) => e.startsWith('BLOCKED_BY'))).toBe(false);
        [build] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
        expect(build!).toMatchObject({ status: 'DRAFT', currentVersion: 3 });

        // Older versions are untouched; the diff shows what the answers changed.
        const v1After = await ctx.db.select().from(bgNodes).where(and(eq(bgNodes.buildId, buildId), eq(bgNodes.designVersion, 1)));
        expect(v1After.map((r) => r.data).sort()).toEqual(v1Before.map((r) => r.data).sort());
        const diff = await diffVersions(buildId, 2, 3);
        expect(diff.added).toEqual(['req:ans_U1']);
        expect(diff.changed).toEqual([
            { key: 'part:main', type: 'PART', fields: ['dimensions', 'dimensionsStatus'] },
            { key: 'unk:U1', type: 'UNKNOWN', fields: ['answer', 'answeredAt', 'status', 'usedDefault'] },
        ]);
        expect(diff.edgesRemoved).toBe(1);
    });

    it('refuses unknown questions, duplicates and questions already answered', async () => {
        const { buildId } = await enclosureBuild();
        await expect(answerUnknowns(buildId, [{ unknownKey: 'unk:U9', value: 'x' }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(answerUnknowns(buildId, [{ unknownKey: 'req:R1', value: 'x' }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(
            answerUnknowns(buildId, [
                { unknownKey: 'unk:U1', value: 'a' },
                { unknownKey: 'unk:U1', value: 'b' },
            ]),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(answerUnknowns(buildId, [{ unknownKey: 'unk:U1', value: '   ' }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await answerUnknowns(buildId, [{ unknownKey: 'unk:U1', value: '100 mm cube' }]);
        await expect(answerUnknowns(buildId, [{ unknownKey: 'unk:U1', value: 'again' }])).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(answerUnknowns('bld_missing', [{ unknownKey: 'unk:U1', value: 'x' }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect((await getGraph(buildId))!.version.version).toBe(2);
    });

    describe('remix and clone', () => {
        it('refuses to fork a build with no approved version', async () => {
            const { buildId } = await enclosureBuild();
            await expect(forkBuild(buildId, 'remix')).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
            await expect(forkBuild('bld_missing', 'clone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        });

        it('remix copies the latest APPROVED version, adds a DERIVED_FROM edge and records lineage', async () => {
            const source = await createBuildFromIntent(await insertIntent(ctx.db, BRACKET_INTENT));
            await approveVersion(source.buildId, 1);
            const sourceV1 = (await getGraph(source.buildId, 1))!;

            const fork = BuildForkResponse.parse(await forkBuild(source.buildId, 'remix'));
            expect(fork.derivedFromBuildId).toBe(source.buildId);
            expect(fork.displayId).not.toBe(source.displayId);

            const [row] = await ctx.db.select().from(builds).where(eq(builds.id, fork.buildId));
            expect(row).toMatchObject({ origin: 'remix', derivedFromBuildId: source.buildId, name: 'Wall shelf bracket (remix)', status: 'DRAFT', currentVersion: 1, intentId: null });

            const view = (await getGraph(fork.buildId))!;
            expect(view.build).toMatchObject({ origin: 'remix', derivedFromBuildId: source.buildId, trustState: 'CONCEPT' });
            expect(view.version).toMatchObject({ version: 1, status: 'DRAFT', parentVersion: null, summary: `Remixed from ${source.displayId} v1` });
            const sourceKey = `build:${source.displayId}`;
            expect(view.nodes.find((n) => n.key === sourceKey)).toMatchObject({ type: 'BUILD', data: { buildId: source.buildId, version: 1, role: 'source' } });
            expect(view.edges).toContainEqual(expect.objectContaining({ type: 'DERIVED_FROM', fromKey: 'build:root', toKey: sourceKey }));
            expect(view.nodes.find((n) => n.key === 'build:root')).toMatchObject({ label: 'Wall shelf bracket (remix)', data: { displayId: fork.displayId, derivedFrom: { buildId: source.buildId, kind: 'remix' } } });
            // Every source node is carried over by key.
            const keys = new Set(view.nodes.map((n) => n.key));
            for (const n of sourceV1.nodes) expect(keys.has(n.key)).toBe(true);

            // The source is unchanged.
            const sourceAfter = (await getGraph(source.buildId))!;
            expect(sourceAfter.versions).toHaveLength(1);
            expect(sourceAfter.nodes.map((n) => [n.key, n.label])).toEqual(sourceV1.nodes.map((n) => [n.key, n.label]));

            const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.buildId, fork.buildId));
            expect(events.map((e) => e.eventType).sort()).toEqual(['build.created', 'build.forked', 'design.version_created']);
            expect(events.find((e) => e.eventType === 'build.forked')!.payload).toEqual({ buildId: fork.buildId, derivedFromBuildId: source.buildId, fromVersion: 1, kind: 'remix' });
        });

        it('clone (Make This) copies without a DERIVED_FROM edge, keeps open questions and takes a custom name', async () => {
            const source = await enclosureBuild();
            await answerUnknowns(source.buildId, [{ unknownKey: 'unk:U2', value: '3' }]);
            await approveVersion(source.buildId, 2);
            await answerUnknowns(source.buildId, [{ unknownKey: 'unk:U1', value: '200 mm' }]); // v3 DRAFT, not cloned

            const fork = await forkBuild(source.buildId, 'clone', 'My enclosure');
            const [row] = await ctx.db.select().from(builds).where(eq(builds.id, fork.buildId));
            expect(row).toMatchObject({ origin: 'clone', name: 'My enclosure', status: 'NEEDS_INPUT', derivedFromBuildId: source.buildId });
            const view = (await getGraph(fork.buildId))!;
            expect(view.version.summary).toBe(`Cloned from ${source.displayId} v2`);
            expect(view.edges.some((e) => e.type === 'DERIVED_FROM')).toBe(false);
            expect(view.nodes.find((n) => n.key === 'unk:U1')!.data.status).toBe('open');
            expect(view.nodes.find((n) => n.key === 'unk:U2')!.data.status).toBe('answered');
            const forked = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.buildId, fork.buildId), eq(domainEvents.eventType, 'build.forked')));
            expect(forked[0]!.payload).toMatchObject({ fromVersion: 2, kind: 'clone' });
        });
    });
});
