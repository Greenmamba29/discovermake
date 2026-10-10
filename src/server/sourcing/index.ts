/**
 * Sourcing bridge (ADR-0005, workflow 03): DiscoverMake's side of the Accio Work
 * integration by inverted control. Accio Work's agent group calls the Sourcing MCP
 * server (./mcp.ts, route `/api/mcp/sourcing`); ops use the admin desk routes
 * (`/api/admin/sourcing/**`); buyers see `/api/builds/:buildId/sourcing`.
 *
 * Module layout:
 *   policy.ts       the approval boundary as data + pure evaluator (unit-tested)
 *   boundary.ts     enforcement + `sourcing.boundary_blocked` records
 *   jobs.ts         queue: create, lease (SKIP LOCKED), lease checks, complete/cancel/requeue
 *   suppliers.ts offers.ts negotiations.ts documents.ts approvals.ts attachments.ts
 *   clients.ts      MCP client tokens;  rate-limit.ts  per-client token bucket
 *   buyer.ts        buyer view + "find partners" + offer selection
 *   auto-request.ts outbox subscriber (REVIEW quote -> job) + lazy relay
 *   mcp.ts          MCP server, tool table, HTTP handler
 */
export * from './errors';
export * from './constants';
export { evaluate, BOUNDARY_RULES, TOOL_ACTIONS, SOURCING_TOOLS, approverRoleFor, type AgentAction, type SourcingToolName } from './policy';
export { enforceBoundary } from './boundary';
export {
    createSourcingJob,
    leaseNextJob,
    assertLease,
    completeJob,
    cancelJob,
    requeueJob,
    switchJobToDesk,
    listJobs,
    getJobView,
    getJobRow,
    type JobWriter,
} from './jobs';
export { submitSupplier } from './suppliers';
export { submitOffer, listJobOffers, listRouteOffers, markStaleOffers, offerTrustLevel, boundExceptions } from './offers';
export { updateNegotiation } from './negotiations';
export { attachDocument } from './documents';
export { requestApproval, decideApproval, listApprovals, requestOfferSelection } from './approvals';
export { getAttachments } from './attachments';
export { createSourcingClient, revokeSourcingClient, authenticateSourcingClient, listSourcingClients } from './clients';
export { getBuildSourcingView, requestBuyerSourcing, selectRouteOffer } from './buyer';
export { handleSourcingEvent } from './auto-request';
export { handleSourcingMcpRequest, mcpMethodNotAllowed } from './mcp';
