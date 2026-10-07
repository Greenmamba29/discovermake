/**
 * Build Graph API (ADR-0001, EPIC-600). Surfaces read and write a Build's graph only
 * through this module.
 *
 *   writeVersion(tx, buildId, { parentVersion, summary, nodes, edges, actor })   new DRAFT version (copy-on-write)
 *   approveVersion(buildId, version)       DRAFT -> APPROVED (immutable); previous APPROVED -> SUPERSEDED
 *   getGraph(buildId, version?)            BuildGraphView
 *   diffVersions(buildId, from, to)        BuildGraphDiff by stable node key
 *   forkBuild(buildId, 'remix'|'clone')    copy the latest APPROVED version into a new build
 *   answerUnknowns(buildId, answers)       NEEDS_INPUT answers -> new version
 *   deriveBuildTrustState(build)           CONCEPT ... ORDERABLE, derived on read, never stored
 *   graphFromIntent(...)                   version 1 of a Make AI build (pure)
 *
 * Every write emits its domain event in the same transaction (ADR-0002).
 */
export { answerUnknowns, AnswerInput, AnswersRequest, answerRequirementKey, MAX_ANSWERS_PER_REQUEST } from './answers';
export { guestActor, isUniqueViolation, loadBuild, setGraphBuildStatus, withDisplayId, type BuildRow } from './builds';
export { loadBuildCatalog, type BuildCatalog, type CatalogMaterial, type CatalogProcess, type CatalogService } from './catalog';
export { forkBuild, type ForkKind } from './fork';
export { clip, compareEdges, compareNodes, diffGraphs, isOpenUnknown, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, ROOT_NODE_KEY, slugify, stableStringify, validateGraph } from './graph';
export {
    graphFromIntent,
    MAIN_PART_KEY,
    matchCatalog,
    matchMaterial,
    matchProcess,
    materialNodeIdentity,
    topicCategory,
    unknownTopic,
    type GraphFromIntentInput,
    type IntentGraph,
    type MaterialAdvice,
    type MaterialPick,
    type UnknownTopic,
} from './intent-graph';
export { buildGraphWriteLimiter, BUILD_GRAPH_WRITE_RATE_LIMIT, limitWrite } from './rate-limit';
export { diffVersions, getGraph, toBuildSummary } from './read';
export { deriveBuildTrustState } from './trust';
export {
    approveVersion,
    latestApprovedVersionRow,
    latestVersionRow,
    listVersions,
    loadVersionGraph,
    toBgEdge,
    toBgNode,
    toDesignVersion,
    toEdgeInput,
    toNodeInput,
    writeVersion,
    type WriteVersionInput,
} from './versions';
