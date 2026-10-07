/**
 * Build Graph contracts (ADR-0001, EPIC-600).
 *
 * One persistent Build per creation. Its graph is stored per DesignVersion
 * (copy-on-write): every accepted change writes a new version with its own node
 * and edge rows, so an APPROVED version is never mutated and quotes, orders and
 * passports can point at an exact version.
 *
 * Nodes carry a stable `key` (e.g. `part:body`, `req:R3`) that is the same across
 * versions, which is what `diff` compares on.
 *
 *   GET  /api/builds/:buildId/graph?version=N   -> BuildGraphView
 *   GET  /api/builds/:buildId/graph/diff?from=A&to=B -> BuildGraphDiff
 *   POST /api/builds/:buildId/remix             -> BuildForkResponse  (fork, DERIVED_FROM edge)
 *   POST /api/builds/:buildId/clone             -> BuildForkResponse  (Make This)
 *
 * Access follows R1 (ADR-0008): builds are addressed by unguessable ids; there are no
 * user accounts yet. Only APPROVED versions can be remixed or cloned.
 */
import { z } from 'zod';
import { BuildDisplayId, BuildId, IsoDateTime, idOf } from './common';
import { BgEdgeType, BgNodeType, BgSource, BuildOrigin, BuildTrustState, DesignVersionStatus } from './enums';

export const BG_NODE_KEY_RE = /^[a-z][a-z0-9_]*:[A-Za-z0-9._-]{1,80}$/;
export const BgNodeKey = z.string().regex(BG_NODE_KEY_RE, 'expected <kind>:<name>, e.g. part:body');

/** Free-form node payload. Engineering fields live here (dimensions, material grade, tolerance...). */
export const BgData = z.record(z.unknown());
export type BgData = z.infer<typeof BgData>;

export const BgNode = z.object({
    id: idOf('bgNode'),
    buildId: BuildId,
    designVersion: z.number().int().positive(),
    key: BgNodeKey,
    type: BgNodeType,
    label: z.string().min(1).max(200),
    data: BgData,
    /** 0..1 for AI-produced nodes; null when a human or a deterministic engine produced it. */
    confidence: z.number().min(0).max(1).nullable(),
    source: BgSource,
    /** Free-text provenance, e.g. a model id, quote id or supplier offer id. */
    provenance: z.string().max(200).nullable(),
});
export type BgNode = z.infer<typeof BgNode>;

export const BgEdge = z.object({
    id: idOf('bgEdge'),
    buildId: BuildId,
    designVersion: z.number().int().positive(),
    type: BgEdgeType,
    fromKey: BgNodeKey,
    toKey: BgNodeKey,
    data: BgData,
});
export type BgEdge = z.infer<typeof BgEdge>;

/** Input shape for writing a graph version (ids, build and version are assigned by the server). */
export const BgNodeInput = BgNode.omit({ id: true, buildId: true, designVersion: true });
export type BgNodeInput = z.infer<typeof BgNodeInput>;
export const BgEdgeInput = BgEdge.omit({ id: true, buildId: true, designVersion: true });
export type BgEdgeInput = z.infer<typeof BgEdgeInput>;

export const DesignVersion = z.object({
    id: idOf('designVersion'),
    buildId: BuildId,
    version: z.number().int().positive(),
    status: DesignVersionStatus,
    /** What changed, in one line ("Answered 3 Make AI questions", "Remixed from DM-7K3QX"). */
    summary: z.string().max(300),
    parentVersion: z.number().int().positive().nullable(),
    createdBy: z.string(),
    approvedBy: z.string().nullable(),
    approvedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
});
export type DesignVersion = z.infer<typeof DesignVersion>;

export const BuildSummary = z.object({
    id: BuildId,
    displayId: BuildDisplayId,
    name: z.string(),
    origin: BuildOrigin,
    /** Derived, never stored: see `deriveBuildTrustState` in src/server/build-graph. */
    trustState: BuildTrustState,
    currentVersion: z.number().int().positive(),
    derivedFromBuildId: BuildId.nullable(),
});
export type BuildSummary = z.infer<typeof BuildSummary>;

export const BuildGraphView = z.object({
    build: BuildSummary,
    version: DesignVersion,
    versions: z.array(DesignVersion.pick({ version: true, status: true, summary: true, createdAt: true })),
    nodes: z.array(BgNode),
    edges: z.array(BgEdge),
});
export type BuildGraphView = z.infer<typeof BuildGraphView>;

export const BgNodeChange = z.object({
    key: BgNodeKey,
    type: BgNodeType,
    /** Top-level `data` fields whose values differ, plus `label` when renamed. */
    fields: z.array(z.string()),
});

export const BuildGraphDiff = z.object({
    buildId: BuildId,
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    added: z.array(BgNodeKey),
    removed: z.array(BgNodeKey),
    changed: z.array(BgNodeChange),
    edgesAdded: z.number().int().nonnegative(),
    edgesRemoved: z.number().int().nonnegative(),
});
export type BuildGraphDiff = z.infer<typeof BuildGraphDiff>;

export const BuildForkRequest = z.object({
    /** Optional new name; defaults to "<name> (remix)" / "<name>". */
    name: z.string().trim().min(1).max(120).optional(),
});
export type BuildForkRequest = z.infer<typeof BuildForkRequest>;

export const BuildForkResponse = z.object({
    buildId: BuildId,
    displayId: BuildDisplayId,
    derivedFromBuildId: BuildId,
});
export type BuildForkResponse = z.infer<typeof BuildForkResponse>;
