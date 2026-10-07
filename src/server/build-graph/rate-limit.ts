/**
 * Per-IP rate limit for Build Graph writes (answers, approve, remix, clone).
 *
 * Same in-memory fixed-window placeholder as Make AI intake (see src/server/make-ai/rate-limit.ts):
 * per-instance counts that reset on deploy. Replace with a shared store with the rest of the
 * R2 rate limits. Reads (graph, diff) are not limited.
 */
import { errorResponse } from '../http';
import { clientIp, FixedWindowRateLimiter, MakeAiRateLimiter } from '../make-ai/rate-limit';

export const BUILD_GRAPH_WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;
export const BUILD_GRAPH_WRITE_GLOBAL_RATE_LIMIT = { limit: 600, windowMs: 60_000 } as const;

export const buildGraphWriteLimiter = new MakeAiRateLimiter(
    new FixedWindowRateLimiter(BUILD_GRAPH_WRITE_RATE_LIMIT.limit, BUILD_GRAPH_WRITE_RATE_LIMIT.windowMs),
    new FixedWindowRateLimiter(BUILD_GRAPH_WRITE_GLOBAL_RATE_LIMIT.limit, BUILD_GRAPH_WRITE_GLOBAL_RATE_LIMIT.windowMs),
);

/** A 429 response (with Retry-After) when `request`'s IP is over the limit, else null. */
export function limitWrite(request: Request, limiter: Pick<MakeAiRateLimiter, 'hit'> = buildGraphWriteLimiter, message = 'Too many changes in a short time. Wait a minute and try again.'): Response | null {
    const decision = limiter.hit(clientIp(request));
    if (decision.allowed) return null;
    const res = errorResponse('RATE_LIMITED', message, 429);
    res.headers.set('retry-after', String(decision.retryAfterSeconds));
    return res;
}
