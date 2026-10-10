/**
 * Pure Build Graph helpers (ADR-0001): validation, ordering, diffing and small text utilities.
 *
 * No database, no clock. `writeVersion` validates every graph through `validateGraph`
 * before a row is written, and `diffGraphs` is the comparison behind
 * `GET /api/builds/:buildId/graph/diff`.
 */
import { z } from 'zod';
import { BgEdgeInput, BgNodeInput, type BgEdge, type BgNode, type BuildGraphDiff } from '../../contracts/build-graph';
import { BG_NODE_TYPES, type BgNodeType } from '../../contracts/enums';
import { ApiError } from '../http';

/** Upper bounds per version: generous for R2 graphs, small enough to keep a version write cheap. */
export const MAX_GRAPH_NODES = 500;
export const MAX_GRAPH_EDGES = 2000;

/** The Build's own node in every graph this module writes. */
export const ROOT_NODE_KEY = 'build:root';

export type GraphInput = { nodes: BgNodeInput[]; edges: BgEdgeInput[] };
type GraphLike = { nodes: Pick<BgNode, 'key' | 'type' | 'label' | 'data'>[]; edges: Pick<BgEdge, 'type' | 'fromKey' | 'toKey'>[] };

export const edgeId = (e: Pick<BgEdge, 'type' | 'fromKey' | 'toKey'>) => `${e.type}|${e.fromKey}|${e.toKey}`;

/**
 * Schema-check a graph and enforce the structural rules the database cannot:
 * node keys are unique, every edge endpoint is a node of the same version,
 * and no edge is repeated. Throws ApiError VALIDATION_FAILED with the first problem.
 */
export function validateGraph(nodes: unknown[], edges: unknown[]): GraphInput {
    if (nodes.length === 0) throw new ApiError('VALIDATION_FAILED', 'A design version needs at least one node');
    if (nodes.length > MAX_GRAPH_NODES) throw new ApiError('VALIDATION_FAILED', `A design version can hold at most ${MAX_GRAPH_NODES} nodes`);
    if (edges.length > MAX_GRAPH_EDGES) throw new ApiError('VALIDATION_FAILED', `A design version can hold at most ${MAX_GRAPH_EDGES} edges`);
    const parsedNodes = z.array(BgNodeInput).safeParse(nodes);
    if (!parsedNodes.success) throw new ApiError('VALIDATION_FAILED', 'Invalid Build Graph node', 400, parsedNodes.error.flatten());
    const parsedEdges = z.array(BgEdgeInput).safeParse(edges);
    if (!parsedEdges.success) throw new ApiError('VALIDATION_FAILED', 'Invalid Build Graph edge', 400, parsedEdges.error.flatten());

    const keys = new Set<string>();
    for (const n of parsedNodes.data) {
        if (keys.has(n.key)) throw new ApiError('VALIDATION_FAILED', `Duplicate node key ${n.key}`);
        keys.add(n.key);
    }
    const seen = new Set<string>();
    for (const e of parsedEdges.data) {
        if (!keys.has(e.fromKey)) throw new ApiError('VALIDATION_FAILED', `Edge ${e.type} starts at missing node ${e.fromKey}`);
        if (!keys.has(e.toKey)) throw new ApiError('VALIDATION_FAILED', `Edge ${e.type} ends at missing node ${e.toKey}`);
        if (e.fromKey === e.toKey) throw new ApiError('VALIDATION_FAILED', `Edge ${e.type} loops on ${e.fromKey}`);
        const id = edgeId(e);
        if (seen.has(id)) throw new ApiError('VALIDATION_FAILED', `Duplicate edge ${e.type} ${e.fromKey} -> ${e.toKey}`);
        seen.add(id);
    }
    return { nodes: parsedNodes.data, edges: parsedEdges.data };
}

const TYPE_ORDER = new Map<BgNodeType, number>(BG_NODE_TYPES.map((t, i) => [t, i]));

/** Deterministic node order: by node type (BG_NODE_TYPES order), then key. */
export function compareNodes(a: Pick<BgNode, 'type' | 'key'>, b: Pick<BgNode, 'type' | 'key'>): number {
    return (TYPE_ORDER.get(a.type) ?? 99) - (TYPE_ORDER.get(b.type) ?? 99) || a.key.localeCompare(b.key, 'en');
}

export function compareEdges(a: Pick<BgEdge, 'type' | 'fromKey' | 'toKey'>, b: Pick<BgEdge, 'type' | 'fromKey' | 'toKey'>): number {
    return edgeId(a).localeCompare(edgeId(b), 'en');
}

/** JSON with sorted object keys, so deep equality does not depend on key order. */
export function stableStringify(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Compare two versions by stable node key: added and removed keys, and for nodes in both
 * the top-level `data` fields whose values differ plus `label` when renamed.
 */
export function diffGraphs(buildId: string, from: number, to: number, a: GraphLike, b: GraphLike): BuildGraphDiff {
    const before = new Map(a.nodes.map((n) => [n.key, n]));
    const after = new Map(b.nodes.map((n) => [n.key, n]));
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const removed = [...before.keys()].filter((k) => !after.has(k)).sort();
    const changed: BuildGraphDiff['changed'] = [];
    for (const [key, next] of after) {
        const prev = before.get(key);
        if (!prev) continue;
        const fields: string[] = [];
        if (prev.label !== next.label) fields.push('label');
        const dataKeys = new Set([...Object.keys(prev.data ?? {}), ...Object.keys(next.data ?? {})]);
        for (const f of [...dataKeys].sort()) {
            if (stableStringify(prev.data?.[f]) !== stableStringify(next.data?.[f])) fields.push(f);
        }
        if (fields.length > 0) changed.push({ key, type: next.type, fields });
    }
    changed.sort((x, y) => x.key.localeCompare(y.key, 'en'));
    const edgesBefore = new Set(a.edges.map(edgeId));
    const edgesAfter = new Set(b.edges.map(edgeId));
    return {
        buildId,
        from,
        to,
        added,
        removed,
        changed,
        edgesAdded: [...edgesAfter].filter((e) => !edgesBefore.has(e)).length,
        edgesRemoved: [...edgesBefore].filter((e) => !edgesAfter.has(e)).length,
    };
}

/** True for an UNKNOWN node that still waits for the buyer's answer. */
export function isOpenUnknown(n: Pick<BgNode, 'type' | 'data'>): boolean {
    return n.type === 'UNKNOWN' && n.data?.status === 'open';
}

/** Trim and cut text to `max` characters (adds an ellipsis when cut). */
export function clip(text: string, max: number): string {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Lowercase slug for node key names: `[a-z0-9-]`, at most `max` characters, never empty. */
export function slugify(text: string, max = 60): string {
    const s = text
        .normalize('NFKD')
        .replace(/₂/g, '2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, max)
        .replace(/-+$/g, '');
    return s || 'item';
}
