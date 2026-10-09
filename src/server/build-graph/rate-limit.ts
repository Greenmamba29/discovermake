/**
 * Per-IP rate limit for Build Graph writes (answers, approve, remix, clone, CAD), plus a
 * fleet-wide budget. Shared store (src/server/rate-limit): Postgres in production, memory in
 * development and tests. Reads (graph, diff) are not limited.
 */
import { errorResponse } from '../http';
import { clientIp } from '../make-ai/rate-limit';
import { CompositeRateLimiter, RateLimiter, type Limiter } from '../rate-limit';

export const BUILD_GRAPH_WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;
export const BUILD_GRAPH_WRITE_GLOBAL_RATE_LIMIT = { limit: 600, windowMs: 60_000 } as const;

export const buildGraphWriteLimiter = new CompositeRateLimiter(
    new RateLimiter('build_graph_write_ip', { kind: 'fixed_window', ...BUILD_GRAPH_WRITE_RATE_LIMIT }),
    new RateLimiter('build_graph_write_global', { kind: 'fixed_window', ...BUILD_GRAPH_WRITE_GLOBAL_RATE_LIMIT }),
);

/** A 429 response (with Retry-After) when `request`'s IP is over the limit, else null. */
export async function limitWrite(request: Request, limiter: Pick<Limiter, 'hit'> = buildGraphWriteLimiter, message = 'Too many changes in a short time. Wait a minute and try again.'): Promise<Response | null> {
    const decision = await limiter.hit(clientIp(request));
    if (decision.allowed) return null;
    const res = errorResponse('RATE_LIMITED', message, 429);
    res.headers.set('retry-after', String(decision.retryAfterSeconds));
    return res;
}
