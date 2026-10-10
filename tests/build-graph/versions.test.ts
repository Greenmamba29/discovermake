/**
 * Build Graph versions (ADR-0001): copy-on-write writes, approval immutability,
 * linear history, graph validation, getGraph and diff by stable node key.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { BuildGraphDiff, BuildGraphView, type BgEdgeInput, type BgNodeInput } from '@/contracts/build-graph';
import { approveVersion, diffGraphs, diffVersions, getGraph, guestActor, writeVersion } from '@/server/build-graph';
import { bgNodes, builds, designVersions, domainEvents } from '@/server/db/schema';
import { newBuildDisplayId, newId } from '@/server/ids';
import { useTestDb } from '../support/db';

const node = (key: string, type: BgNodeInput['type'], label: string, data: Record<string, unknown> = {}): BgNodeInput => ({ key, type, label, data, confidence: null, source: 'system', provenance: null });
const edge = (type: BgEdgeInput['type'], fromKey: string, toKey: string): BgEdgeInput => ({ type, fromKey, toKey, data: {} });

const V1_NODES = [node('build:root', 'BUILD', 'Bracket'), node('part:main', 'PART', 'Main part', { dimensions: [] }), node('mat:aluminum-5052', 'MATERIAL', 'Aluminum 5052-H32', { role: 'candidate' })];
const V1_EDGES = [edge('CONTAINS', 'build:root', 'part:main'), edge('MADE_OF', 'part:main', 'mat:aluminum-5052')];

describe('Build Graph versions', () => {
    const ctx = useTestDb();

    async function newBuild(): Promise<string> {
        const id = newId('build');
        await ctx.db.insert(builds).values({ id, displayId: newBuildDisplayId(), name: 'Bracket', origin: 'make_ai' });
        return id;
    }

    async function write(buildId: string, parentVersion: number | null, nodes: BgNodeInput[], edges: BgEdgeInput[], summary = 'test') {
        return ctx.db.transaction((tx) => writeVersion(tx, buildId, { parentVersion, summary, nodes, edges, actor: guestActor(buildId) }));
    }

    it('writes DRAFT versions with their own rows, bumps current_version and emits design.version_created', async () => {
        const buildId = await newBuild();
        const v1 = await write(buildId, null, V1_NODES, V1_EDGES, 'Drafted');
        expect(v1).toMatchObject({ buildId, version: 1, status: 'DRAFT', parentVersion: null, summary: 'Drafted', createdBy: `buyer:guest:${buildId}` });

        const v2 = await write(buildId, 1, [...V1_NODES, node('req:R1', 'REQUIREMENT', 'Holds 20 kg')], [...V1_EDGES, edge('CONSTRAINED_BY', 'build:root', 'req:R1')]);
        expect(v2.version).toBe(2);
        const [build] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
        expect(build!.currentVersion).toBe(2);

        const rows = await ctx.db.select().from(bgNodes).where(eq(bgNodes.buildId, buildId));
        expect(rows.filter((r) => r.designVersion === 1)).toHaveLength(3);
        expect(rows.filter((r) => r.designVersion === 2)).toHaveLength(4);

        const events = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.buildId, buildId), eq(domainEvents.eventType, 'design.version_created')));
        expect(events.map((e) => e.payload)).toEqual(
            expect.arrayContaining([
                { buildId, version: 1, parentVersion: null, summary: 'Drafted', nodeCount: 3, edgeCount: 2 },
                { buildId, version: 2, parentVersion: 1, summary: 'test', nodeCount: 4, edgeCount: 3 },
            ]),
        );
    });

    it('refuses invalid graphs: duplicate keys, dangling edges, bad keys, duplicate edges', async () => {
        const buildId = await newBuild();
        await expect(write(buildId, null, [V1_NODES[0]!, V1_NODES[0]!], [])).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/duplicate node key/i) });
        await expect(write(buildId, null, V1_NODES, [edge('CONTAINS', 'build:root', 'part:missing')])).rejects.toMatchObject({ message: expect.stringMatching(/missing node part:missing/) });
        await expect(write(buildId, null, [node('Not A Key', 'PART', 'x')], [])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(write(buildId, null, V1_NODES, [V1_EDGES[0]!, V1_EDGES[0]!])).rejects.toMatchObject({ message: expect.stringMatching(/duplicate edge/i) });
        await expect(write(buildId, null, [], [])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(await ctx.db.select().from(designVersions).where(eq(designVersions.buildId, buildId))).toHaveLength(0);
    });

    it('keeps history linear: a write must build on the latest version', async () => {
        const buildId = await newBuild();
        await write(buildId, null, V1_NODES, V1_EDGES);
        await expect(write(buildId, null, V1_NODES, V1_EDGES)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
        await write(buildId, 1, V1_NODES, V1_EDGES);
        await expect(write(buildId, 1, V1_NODES, V1_EDGES)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/latest version is 2/) });
        await expect(ctx.db.transaction((tx) => writeVersion(tx, 'bld_missing', { parentVersion: null, summary: 'x', nodes: V1_NODES, edges: [], actor: guestActor('x') }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('approval makes a version immutable; writing on top creates a new version and supersedes on the next approval', async () => {
        const buildId = await newBuild();
        await write(buildId, null, V1_NODES, V1_EDGES);
        const approved = await approveVersion(buildId, 1);
        expect(approved).toMatchObject({ version: 1, status: 'APPROVED', approvedBy: `buyer:guest:${buildId}` });
        expect(approved.approvedAt).not.toBeNull();
        // Idempotent, no second event.
        await approveVersion(buildId, 1);

        const before = await ctx.db.select().from(bgNodes).where(and(eq(bgNodes.buildId, buildId), eq(bgNodes.designVersion, 1)));
        const changedNodes = V1_NODES.map((n) => (n.key === 'part:main' ? { ...n, label: 'Bracket body', data: { dimensions: [{ text: '200 mm' }] } } : n));
        const v2 = await write(buildId, 1, changedNodes, V1_EDGES, 'Renamed the part');
        expect(v2).toMatchObject({ version: 2, status: 'DRAFT', parentVersion: 1 });

        // Version 1 rows are untouched.
        const after = await ctx.db.select().from(bgNodes).where(and(eq(bgNodes.buildId, buildId), eq(bgNodes.designVersion, 1)));
        expect(after.map((r) => [r.id, r.label, r.data]).sort()).toEqual(before.map((r) => [r.id, r.label, r.data]).sort());

        await approveVersion(buildId, 2);
        const versions = await ctx.db.select().from(designVersions).where(eq(designVersions.buildId, buildId));
        expect(Object.fromEntries(versions.map((v) => [v.version, v.status]))).toEqual({ 1: 'SUPERSEDED', 2: 'APPROVED' });
        await expect(approveVersion(buildId, 1)).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(approveVersion(buildId, 9)).rejects.toMatchObject({ code: 'NOT_FOUND' });

        const approvals = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.buildId, buildId), eq(domainEvents.eventType, 'design.version_approved')));
        expect(approvals.map((e) => (e.payload as { version: number }).version).sort()).toEqual([1, 2]);
    });

    it('refuses to approve a version older than the approved one', async () => {
        const buildId = await newBuild();
        await write(buildId, null, V1_NODES, V1_EDGES);
        await write(buildId, 1, V1_NODES, V1_EDGES);
        await approveVersion(buildId, 2);
        await expect(approveVersion(buildId, 1)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/already approved/) });
    });

    it('getGraph returns a contract-valid BuildGraphView for the current or a given version', async () => {
        const buildId = await newBuild();
        await write(buildId, null, V1_NODES, V1_EDGES, 'First');
        await write(buildId, 1, [...V1_NODES, node('req:R1', 'REQUIREMENT', 'Holds 20 kg')], V1_EDGES, 'Second');

        const current = BuildGraphView.parse(await getGraph(buildId));
        expect(current.version.version).toBe(2);
        expect(current.build).toMatchObject({ id: buildId, origin: 'make_ai', currentVersion: 2, trustState: 'CONCEPT', derivedFromBuildId: null });
        expect(current.versions.map((v) => [v.version, v.summary])).toEqual([
            [1, 'First'],
            [2, 'Second'],
        ]);
        // Deterministic order: by node type, then key.
        expect(current.nodes.map((n) => n.key)).toEqual(['build:root', 'req:R1', 'part:main', 'mat:aluminum-5052']);

        const first = await getGraph(buildId, 1);
        expect(first!.nodes).toHaveLength(3);
        await expect(getGraph(buildId, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await getGraph('bld_nope')).toBeNull();

        // R1 upload builds have no graph.
        const upload = newId('build');
        await ctx.db.insert(builds).values({ id: upload, displayId: newBuildDisplayId(), name: 'Upload' });
        expect(await getGraph(upload)).toBeNull();
    });

    it('diffs versions by node key: added, removed, changed data fields + label, edge counts', async () => {
        const buildId = await newBuild();
        await write(buildId, null, V1_NODES, V1_EDGES);
        const v2Nodes = [
            V1_NODES[0]!,
            { ...V1_NODES[1]!, label: 'Bracket body', data: { dimensions: [{ text: '200 mm' }], dimensionsStatus: 'stated' } },
            node('req:ans_U1', 'REQUIREMENT', '200 mm'),
        ];
        await write(buildId, 1, v2Nodes, [edge('CONTAINS', 'build:root', 'part:main'), edge('CONSTRAINED_BY', 'build:root', 'req:ans_U1')]);

        const diff = BuildGraphDiff.parse(await diffVersions(buildId, 1, 2));
        expect(diff).toEqual({
            buildId,
            from: 1,
            to: 2,
            added: ['req:ans_U1'],
            removed: ['mat:aluminum-5052'],
            changed: [{ key: 'part:main', type: 'PART', fields: ['label', 'dimensions', 'dimensionsStatus'] }],
            edgesAdded: 1,
            edgesRemoved: 1,
        });
        expect((await diffVersions(buildId, 2, 2)).changed).toEqual([]);
        await expect(diffVersions(buildId, 1, 5)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('diffGraphs ignores data key order', () => {
        const a = { nodes: [{ key: 'part:a', type: 'PART' as const, label: 'A', data: { x: { b: 1, a: [1, 2] }, y: 1 } }], edges: [] };
        const b = { nodes: [{ key: 'part:a', type: 'PART' as const, label: 'A', data: { y: 1, x: { a: [1, 2], b: 1 } } }], edges: [] };
        expect(diffGraphs('bld_x', 1, 2, a, b).changed).toEqual([]);
    });
});
