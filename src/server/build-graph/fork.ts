/**
 * Remix (fork with a DERIVED_FROM edge) and Make This (clone), ADR-0001.
 *
 * Both copy the source build's latest APPROVED design version into version 1 of a new
 * build (origin remix | clone, derived_from_build_id set, new display id). The source is
 * only read, never changed. A build with no approved version cannot be forked (409).
 * Emits `build.created`, `design.version_created` and `build.forked` in one transaction.
 */
import type { BgEdgeInput, BgNodeInput, BuildForkResponse } from '../../contracts/build-graph';
import { getDb, type DbOrTx } from '../db';
import { builds } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { guestActor, loadBuild, withDisplayId } from './builds';
import { clip, isOpenUnknown, ROOT_NODE_KEY } from './graph';
import { latestApprovedVersionRow, loadVersionGraph, toEdgeInput, toNodeInput, writeVersion } from './versions';

export type ForkKind = 'remix' | 'clone';

export async function forkBuild(buildId: string, kind: ForkKind, name?: string, opts: { db?: DbOrTx } = {}): Promise<BuildForkResponse> {
    const db = opts.db ?? getDb();
    return withDisplayId((displayId) =>
        db.transaction(async (tx) => {
            const source = await loadBuild(tx, buildId);
            if (!source) throw new ApiError('NOT_FOUND', 'Build not found');
            const approved = await latestApprovedVersionRow(tx, buildId);
            if (!approved) throw new ApiError('CONFLICT', 'Approve a design version of this build before you remix or clone it.');
            const graph = await loadVersionGraph(tx, buildId, approved.version);

            const id = newId('build');
            const actor = guestActor(id);
            const newName = clip(name ?? (kind === 'remix' ? `${source.name} (remix)` : source.name), 120);
            const nodes: BgNodeInput[] = graph.nodes.map(toNodeInput);
            const edges: BgEdgeInput[] = graph.edges.map(toEdgeInput);

            // The copied root node now describes the new build (this is the new build's own version 1).
            const found = nodes.find((n) => n.key === ROOT_NODE_KEY) ?? nodes.find((n) => n.type === 'BUILD');
            const root: BgNodeInput = found ?? { key: ROOT_NODE_KEY, type: 'BUILD', label: newName, data: {}, confidence: null, source: 'system', provenance: null };
            if (!found) nodes.unshift(root);
            root.label = newName;
            root.data = { ...root.data, displayId, derivedFrom: { buildId: source.id, displayId: source.displayId, version: approved.version, kind } };

            if (kind === 'remix') {
                const sourceKey = `build:${source.displayId}`;
                if (!nodes.some((n) => n.key === sourceKey)) {
                    nodes.push({
                        key: sourceKey,
                        type: 'BUILD',
                        label: clip(source.name, 200),
                        data: { buildId: source.id, displayId: source.displayId, version: approved.version, role: 'source' },
                        confidence: null,
                        source: 'system',
                        provenance: `${source.id}@v${approved.version}`,
                    });
                }
                if (!edges.some((e) => e.type === 'DERIVED_FROM' && e.fromKey === root.key && e.toKey === sourceKey)) {
                    edges.push({ type: 'DERIVED_FROM', fromKey: root.key, toKey: sourceKey, data: { version: approved.version } });
                }
            }

            await tx.insert(builds).values({
                id,
                displayId,
                name: newName,
                status: nodes.some(isOpenUnknown) ? 'NEEDS_INPUT' : 'DRAFT',
                origin: kind,
                derivedFromBuildId: source.id,
                currentVersion: 1,
            });
            await emitEvent(tx, { type: 'build.created', payload: { buildId: id, displayId, name: newName }, actor, correlationId: id, buildId: id });
            await writeVersion(tx, id, {
                parentVersion: null,
                summary: `${kind === 'remix' ? 'Remixed' : 'Cloned'} from ${source.displayId} v${approved.version}`,
                nodes,
                edges,
                actor,
            });
            await emitEvent(tx, {
                type: 'build.forked',
                payload: { buildId: id, derivedFromBuildId: source.id, fromVersion: approved.version, kind },
                actor,
                correlationId: id,
                buildId: id,
            });
            return { buildId: id, displayId, derivedFromBuildId: source.id };
        }),
    );
}
