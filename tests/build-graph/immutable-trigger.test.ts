/**
 * Stage 1 hardening: the database refuses to change an approved Build Graph version
 * (database/migrations/manual/0005_approved_graph_immutable.sql, applied by migrateDatabase).
 */
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { approveVersion, getGraph, loadVersionGraph, toEdgeInput, toNodeInput, writeVersion } from '@/server/build-graph';
import { migrateDatabase } from '@/server/db/migrate';
import { createBuildFromIntent } from '@/server/make-ai/builds';
import { BRACKET_INTENT, insertIntent } from './fixtures';
import { useTestDb as withTestDb } from '../support/db';

const ctx = withTestDb({ seed: true });
let buildId = '';

async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        return e.cause?.code ?? e.code ?? 'unknown';
    }
}

beforeAll(async () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    buildId = (await createBuildFromIntent(await insertIntent(ctx.db, BRACKET_INTENT))).buildId;
    await approveVersion(buildId, 1);
});

describe('approved design versions are immutable in Postgres', () => {
    it('rejects UPDATE, DELETE and INSERT on bg_nodes / bg_edges of an approved version', async () => {
        expect(await sqlState(() => ctx.db.execute(sql`update bg_nodes set label = 'tampered' where build_id = ${buildId} and design_version = 1`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`update bg_nodes set data = '{"width_mm": 999}'::jsonb where build_id = ${buildId} and design_version = 1 and key = 'part:main'`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`delete from bg_edges where build_id = ${buildId} and design_version = 1`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`delete from bg_nodes where build_id = ${buildId} and design_version = 1`))).toBe('DM001');
        expect(
            await sqlState(() => ctx.db.execute(sql`insert into bg_nodes (id, build_id, design_version, key, type, label, data, source) values ('bgn_injected00000000000', ${buildId}, 1, 'req:injected', 'REQUIREMENT', 'x', '{}'::jsonb, 'user')`)),
        ).toBe('DM001');
        const graph = await getGraph(buildId, 1);
        expect(graph?.nodes.some((n) => n.label === 'tampered' || n.key === 'req:injected')).toBe(false);
    });

    it('rejects editing or un-approving the approved version row', async () => {
        expect(await sqlState(() => ctx.db.execute(sql`update design_versions set summary = 'rewritten' where build_id = ${buildId} and version = 1`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`update design_versions set status = 'DRAFT' where build_id = ${buildId} and version = 1`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`update design_versions set approved_by = 'someone-else' where build_id = ${buildId} and version = 1`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`delete from design_versions where build_id = ${buildId} and version = 1`))).toBe('DM001');
    });

    it('leaves DRAFT versions editable and lets approval supersede, then freezes the superseded version', async () => {
        const v1 = await loadVersionGraph(ctx.db, buildId, 1);
        const v2 = await ctx.db.transaction((tx) => writeVersion(tx, buildId, { parentVersion: 1, summary: 'Tweak', nodes: v1.nodes.map(toNodeInput), edges: v1.edges.map(toEdgeInput), actor: { kind: 'buyer', id: `guest:${buildId}` } }));
        expect(v2.version).toBe(2);
        expect(await sqlState(() => ctx.db.execute(sql`update bg_nodes set label = 'draft edit' where build_id = ${buildId} and design_version = 2 and key = 'build:root'`))).toBeNull();
        expect(await sqlState(() => ctx.db.execute(sql`update design_versions set summary = 'Tweak (renamed)' where build_id = ${buildId} and version = 2`))).toBeNull();

        await approveVersion(buildId, 2); // v1 APPROVED -> SUPERSEDED through the trigger
        const rows = await ctx.db.execute(sql`select version, status from design_versions where build_id = ${buildId} order by version`);
        expect([...(rows as unknown as { version: number; status: string }[])].map((r) => `${r.version}:${r.status}`)).toEqual(['1:SUPERSEDED', '2:APPROVED']);
        expect(await sqlState(() => ctx.db.execute(sql`update design_versions set status = 'APPROVED' where build_id = ${buildId} and version = 1`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`update bg_nodes set label = 'late edit' where build_id = ${buildId} and design_version = 1`))).toBe('DM001');
        expect(await sqlState(() => ctx.db.execute(sql`update bg_nodes set label = 'late edit' where build_id = ${buildId} and design_version = 2`))).toBe('DM001');
    });

    it('still allows deleting a whole build (cascade)', async () => {
        const other = (await createBuildFromIntent(await insertIntent(ctx.db, BRACKET_INTENT))).buildId;
        await approveVersion(other, 1);
        await ctx.db.execute(sql`update make_intents set build_id = null where build_id = ${other}`); // not cascaded (by design)
        await ctx.db.execute(sql`update builds set intent_id = null where id = ${other}`);
        expect(await sqlState(() => ctx.db.execute(sql`delete from builds where id = ${other}`))).toBeNull();
        const left = await ctx.db.execute(sql`select count(*)::int as n from bg_nodes where build_id = ${other}`);
        expect((left as unknown as { n: number }[])[0]!.n).toBe(0);
    });

    it('is idempotent: migrating again keeps one trigger per table', async () => {
        await migrateDatabase(ctx.testDb.url);
        await migrateDatabase(ctx.testDb.url);
        const triggers = await ctx.db.execute(sql`select event_object_table as t, count(distinct trigger_name)::int as n from information_schema.triggers where trigger_name like '%_immutable' group by 1 order by 1`);
        expect([...(triggers as unknown as { t: string; n: number }[])]).toEqual([
            { t: 'bg_edges', n: 1 },
            { t: 'bg_nodes', n: 1 },
            { t: 'design_versions', n: 1 },
        ]);
    });
});
