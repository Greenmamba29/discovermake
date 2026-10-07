/**
 * Tunables of the sourcing bridge (ADR-0005, workflow 03). Constants, not env vars:
 * changing one is a reviewed code change, like the Accio agent group config.
 */

/** Visibility timeout of a `next_job` lease. Every write under the lease extends it by this much. */
export const LEASE_TTL_MS = 30 * 60 * 1000;

/** Signed package URLs handed to an agent expire after 15 minutes. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

/** `attach_document` cap (decoded bytes). */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** MCP request body cap (a base64 document of 5 MB is ~6.7 MB of JSON). */
export const MCP_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** `request_approval.details` is free-form; keep it small enough to read. */
export const MAX_APPROVAL_DETAILS_CHARS = 8 * 1024;

/** One-time bearer tokens for MCP clients: `dmsc_<43 chars>`. */
export const SOURCING_TOKEN_PREFIX = 'dmsc';

/** Per-client MCP tool-call budget (token bucket): bursts of 60, 1 call/s sustained. */
export const MCP_RATE_LIMIT = { capacity: 60, refillPerSecond: 1 } as const;

/** Buyer "Find manufacturing partners" requests per IP per minute. */
export const BUYER_SOURCING_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const;

/** Statuses in which a job is still being worked (one open job per part/version/quantity). */
export const OPEN_JOB_STATUSES = ['QUEUED', 'LEASED', 'IN_PROGRESS'] as const;

/** Statuses a job never leaves. */
export const TERMINAL_JOB_STATUSES = ['COMPLETE', 'CANCELLED', 'FAILED'] as const;
