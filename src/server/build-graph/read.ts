/**
 * Build Graph reads: `getGraph` (BuildGraphView for one version) and `diffVersions`
 * (BuildGraphDiff between two versions, compared by stable node key).
 */
import type { BuildGraphDiff, BuildGraphView, BuildSummary } from '../../contracts/build-graph';
import { getDb, type DbOrTx } from '../db';
import { ApiError } from '../http';
import { loadBuild, type BuildRow } from './builds';
import { diffGraphs } from './graph';
import { deriveBuildTrustState } from './trust';
import { listVersions, loadVersionGraph, toDesignVersion } from './versions';

export async function toBuildSummary(build: BuildRow, db: DbOrTx = getDb()): Promise<BuildSummary> {
    return {
        id: build.id,
        displayId: build.displayId,
        name: build.name,
        origin: build.origin,
        trustState: await deriveBuildTrustState(build, db),
        currentVersion: build.currentVersion,
        derivedFromBuildId: build.derivedFromBuildId,
    };
}

/**
 * The graph of one design version (default: the build's current version).
 * Returns null when the build does not exist or has no Build Graph (R1 upload builds).
 * @throws ApiError NOT_FOUND when the requested version does not exist.
 */
export async function getGraph(buildId: string, version?: number, db: DbOrTx = getDb()): Promise<BuildGraphView | null> {
    const build = await loadBuild(db, buildId);
    if (!build) return null;
    const versions = await listVersions(db, buildId);
    if (versions.length === 0) return null;
    const wanted = version ?? build.currentVersion;
    const target = versions.find((v) => v.version === wanted) ?? (version === undefined ? versions[versions.length - 1] : undefined);
    if (!target) throw new ApiError('NOT_FOUND', `Version ${wanted} not found`);
    const [graph, summary] = await Promise.all([loadVersionGraph(db, buildId, target.version), toBuildSummary(build, db)]);
    return {
        build: summary,
        version: toDesignVersion(target),
        versions: versions.map((v) => ({ version: v.version, status: v.status, summary: v.summary, createdAt: v.createdAt.toISOString() })),
        nodes: graph.nodes,
        edges: graph.edges,
    };
}

/**
 * Diff version `from` against version `to` of one build.
 * @throws ApiError NOT_FOUND (build or either version).
 */
export async function diffVersions(buildId: string, from: number, to: number, db: DbOrTx = getDb()): Promise<BuildGraphDiff> {
    const build = await loadBuild(db, buildId);
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    const versions = new Set((await listVersions(db, buildId)).map((v) => v.version));
    for (const v of [from, to]) if (!versions.has(v)) throw new ApiError('NOT_FOUND', `Version ${v} not found`);
    const [a, b] = await Promise.all([loadVersionGraph(db, buildId, from), loadVersionGraph(db, buildId, to)]);
    return diffGraphs(buildId, from, to, a, b);
}
