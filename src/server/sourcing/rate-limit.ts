/**
 * Per-client token bucket for MCP tool calls, on the shared limiter (src/server/rate-limit):
 * Postgres in production (one bucket per client for the whole fleet), memory in development
 * and tests. `TokenBucketRateLimiter` (the in-memory algorithm) is re-exported for its unit tests.
 */
import { RateLimiter, TokenBucketRateLimiter, type RateLimitDecision } from '../rate-limit';
import { BUYER_SOURCING_RATE_LIMIT, MCP_RATE_LIMIT } from './constants';

export { TokenBucketRateLimiter };
export type BucketDecision = RateLimitDecision;

export const mcpRateLimiter = new RateLimiter('mcp_client', { kind: 'token_bucket', ...MCP_RATE_LIMIT });

/** Buyer "Find manufacturing partners" requests per IP. */
export const buyerSourcingLimiter = new RateLimiter('buyer_sourcing_ip', { kind: 'fixed_window', ...BUYER_SOURCING_RATE_LIMIT });
