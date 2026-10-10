/**
 * DesignVersion writes (ADR-0001, copy-on-write graph).
 *
 *   writeVersion(tx, buildId, { parentVersion, summary, nodes, edges, actor })
 *       validates the graph, inserts a DRAFT design version with its own node + edge rows,
 *       bumps builds.current_version and emits `design.version_created` in the same tx.
 *   approveVersion(buildId, version, actor)
 *       DRAFT -> APPROVED (immutable); the previously APPROVED version becomes SUPERSEDED.
 *       Emits `design.version_approved`.
 *
 * Nothing in this module ever updates or deletes a node or edge row: a change is always a
 * new version, so an APPROVED version (and anything quoted or ordered against it) stays exact.
 * History is linear: a write must name the latest version as its parent (409 otherwise).
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { BgEdge, BgEdgeInput, BgNode, BgNodeInput, DesignVersion } from '../../contracts/build-graph';
import { actorId, type Actor } from '../../contracts/common';
import { getDb, type DbOrTx } from '../db';
import { bgEdges, bgNodes, builds, designVersions } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { guestActor, loadBuild } from './builds';
import { compareEdges, compareNodes, validateGraph } from './graph';

type DesignVersionRow = typeof designVersions.$inferSelect;
type NodeRow = typeof bgNodes.$inferSelect;
type EdgeRow = typeof bgEdges.$inferSelect;

export type WriteVersionInput = {
    /** The version this one builds on: must be the build's latest version, or null for the first. */
    parentVersion: number | null;
    /** One line, e.g. "Answered 3 Make AI questions". */
    summary: string;
    nodes: BgNodeInput[];
    edges: BgEdgeInput[];
    actor: Actor;
    /** Journey id for the event (default: the build id), e.g. the Make AI intent id. */
    correlationId?: string;
};

export function toDesignVersion(row: DesignVersionRow): DesignVersion {
    return {
        id: row.id,
        buildId: row.buildId,
        version: row.version,
        status: row.status,
        summary: row.summary,
        parentVersion: row.parentVersion,
        createdBy: row.createdBy,
        approvedBy: row.approvedBy,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
    };
}

export function toBgNode(row: NodeRow): BgNode {
    return {
        id: row.id,
        buildId: row.buildId,
        designVersion: row.designVersion,
        key: row.key,
        type: row.type,
        label: row.label,
        data: row.data ?? {},
        confidence: row.confidence,
        source: row.source,
        provenance: row.provenance,
    };
}

export function toBgEdge(row: EdgeRow): BgEdge {
    return { id: row.id, buildId: row.buildId, designVersion: row.designVersion, type: row.type, fromKey: row.fromKey, toKey: row.toKey, data: row.data ?? {} };
}

/** Strip server-assigned fields so a stored graph can be written again as a new version. */
export function toNodeInput(n: BgNode): BgNodeInput {
    return { key: n.key, type: n.type, label: n.label, data: structuredClone(n.data), confidence: n.confidence, source: n.source, provenance: n.provenance };
}

export function toEdgeInput(e: BgEdge): BgEdgeInput {
    return { type: e.type, fromKey: e.fromKey, toKey: e.toKey, data: structuredClone(e.data) };
}

export async function listVersions(db: DbOrTx, buildId: string): Promise<DesignVersionRow[]> {
    return db.select().from(designVersions).where(eq(designVersions.buildId, buildId)).orderBy(asc(designVersions.version));
}

export async function latestVersionRow(db: DbOrTx, buildId: string): Promise<DesignVersionRow | null> {
    const [row] = await db.select().from(designVersions).where(eq(designVersions.buildId, buildId)).orderBy(desc(designVersions.version)).limit(1);
    return row ?? null;
}

export async function latestApprovedVersionRow(db: DbOrTx, buildId: string): Promise<DesignVersionRow | null> {
    const [row] = await db
        .select()
        .from(designVersions)
        .where(and(eq(designVersions.buildId, buildId), eq(designVersions.status, 'APPROVED')))
        .orderBy(desc(designVersions.version))
        .limit(1);
    return row ?? null;
}

/** Nodes + edges of one version, in a deterministic order. */
export async function loadVersionGraph(db: DbOrTx, buildId: string, version: number): Promise<{ nodes: BgNode[]; edges: BgEdge[] }> {
    const [nodeRows, edgeRows] = await Promise.all([
        db.select().from(bgNodes).where(and(eq(bgNodes.buildId, buildId), eq(bgNodes.designVersion, version))),
        db.select().from(bgEdges).where(and(eq(bgEdges.buildId, buildId), eq(bgEdges.designVersion, version))),
    ]);
    return { nodes: nodeRows.map(toBgNode).sort(compareNodes), edges: edgeRows.map(toBgEdge).sort(compareEdges) };
}

/**
 * Write a new DRAFT version (see module doc). Call inside the transaction that owns the change.
 * @throws ApiError VALIDATION_FAILED (bad graph), NOT_FOUND (build), CONFLICT (stale parent).
 */
export async function writeVersion(tx: DbOrTx, buildId: string, input: WriteVersionInput): Promise<DesignVersion> {
    const { nodes, edges } = validateGraph(input.nodes, input.edges);
    const summary = input.summary.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!summary) throw new ApiError('VALIDATION_FAILED', 'A design version needs a summary');

    // Serialize writers per build: version numbers are max + 1 under this lock.
    const build = await loadBuild(tx, buildId, { lock: true });
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    const latest = await latestVersionRow(tx, buildId);
    const latestVersion = latest?.version ?? null;
    if (input.parentVersion !== latestVersion) {
        throw new ApiError(
            'CONFLICT',
            latestVersion === null ? 'This build has no design version to build on yet.' : `This build changed in the meantime: the latest version is ${latestVersion}. Refresh and try again.`,
            409,
        );
    }
    const version = (latestVersion ?? 0) + 1;
    const createdBy = actorId(input.actor);

    const [row] = await tx.insert(designVersions).values({ buildId, version, status: 'DRAFT', summary, parentVersion: input.parentVersion, createdBy }).returning();
    await tx.insert(bgNodes).values(
        nodes.map((n) => ({ buildId, designVersion: version, key: n.key, type: n.type, label: n.label, data: n.data, confidence: n.confidence, source: n.source, provenance: n.provenance })),
    );
    if (edges.length > 0) {
        await tx.insert(bgEdges).values(edges.map((e) => ({ buildId, designVersion: version, type: e.type, fromKey: e.fromKey, toKey: e.toKey, data: e.data })));
    }
    await tx.update(builds).set({ currentVersion: version, updatedAt: new Date() }).where(eq(builds.id, buildId));
    await emitEvent(tx, {
        type: 'design.version_created',
        payload: { buildId, version, parentVersion: input.parentVersion, summary, nodeCount: nodes.length, edgeCount: edges.length },
        actor: input.actor,
        correlationId: input.correlationId ?? buildId,
        buildId,
    });
    return toDesignVersion(row!);
}

/**
 * Approve a DRAFT version: it becomes immutable (APPROVED) and the previously approved
 * version is SUPERSEDED. Approving an already APPROVED version is a no-op.
 * @throws ApiError NOT_FOUND (build / version), CONFLICT (superseded, or older than the approved one).
 */
export async function approveVersion(buildId: string, version: number, opts: { actor?: Actor; db?: DbOrTx } = {}): Promise<DesignVersion> {
    const actor = opts.actor ?? guestActor(buildId);
    return (opts.db ?? getDb()).transaction(async (tx) => {
        const build = await loadBuild(tx, buildId, { lock: true });
        if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
        const [target] = await tx
            .select()
            .from(designVersions)
            .where(and(eq(designVersions.buildId, buildId), eq(designVersions.version, version)));
        if (!target) throw new ApiError('NOT_FOUND', `Version ${version} not found`);
        if (target.status === 'APPROVED') return toDesignVersion(target);
        if (target.status === 'SUPERSEDED') throw new ApiError('CONFLICT', `Version ${version} was superseded by a newer approved version.`);

        const current = await latestApprovedVersionRow(tx, buildId);
        if (current && current.version > version) {
            throw new ApiError('CONFLICT', `Version ${current.version} is already approved. Approve a newer version instead.`);
        }
        if (current) {
            await tx
                .update(designVersions)
                .set({ status: 'SUPERSEDED' })
                .where(and(eq(designVersions.id, current.id), eq(designVersions.status, 'APPROVED')));
        }
        const approvedBy = actorId(actor);
        const [row] = await tx
            .update(designVersions)
            .set({ status: 'APPROVED', approvedBy, approvedAt: sql`now()` })
            .where(and(eq(designVersions.id, target.id), eq(designVersions.status, 'DRAFT')))
            .returning();
        if (!row) throw new ApiError('CONFLICT', `Version ${version} changed in the meantime. Refresh and try again.`);
        await emitEvent(tx, { type: 'design.version_approved', payload: { buildId, version, approvedBy }, actor, correlationId: buildId, buildId });
        return toDesignVersion(row);
    });
}
