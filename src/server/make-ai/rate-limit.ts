/**
 * Per-IP fixed-window rate limit for Make AI intake, plus a fleet-wide budget.
 *
 * Backed by the shared limiter (src/server/rate-limit): Postgres in production, so every
 * instance counts against the same windows; per-instance memory in development and tests.
 * Keys are stored hashed and expire with their window (an IP is never logged or persisted raw).
 */
import { CompositeRateLimiter, FixedWindowRateLimiter, RateLimiter, type RateLimitDecision } from '../rate-limit';

export { FixedWindowRateLimiter, type RateLimitDecision };

export const MAKE_AI_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

/**
 * Fleet-wide cap across all IPs: bounds model spend even when a client rotates
 * (spoofed) IPs to dodge the per-IP limit.
 */
export const MAKE_AI_GLOBAL_RATE_LIMIT = { limit: 120, windowMs: 60_000 } as const;

/** Per-IP limiter plus a global budget; both must allow the request (the shared `CompositeRateLimiter`). */
export class MakeAiRateLimiter extends CompositeRateLimiter {}

export const makeAiRateLimiter = new MakeAiRateLimiter(
    new RateLimiter('make_ai_ip', { kind: 'fixed_window', ...MAKE_AI_RATE_LIMIT }),
    new RateLimiter('make_ai_global', { kind: 'fixed_window', ...MAKE_AI_GLOBAL_RATE_LIMIT }),
);

/**
 * Best-effort client IP. Prefers headers set by the platform (Vercel overwrites
 * x-real-ip / x-vercel-forwarded-for). For x-forwarded-for it takes the RIGHTMOST
 * entry, the one appended by the proxy nearest to us: a client can prepend any value
 * it likes, but cannot change what our own proxy appends.
 */
export function clientIp(request: Request): string {
    for (const name of ['x-vercel-forwarded-for', 'x-real-ip']) {
        const v = request.headers.get(name)?.split(',')[0]?.trim();
        if (v) return v.slice(0, 64);
    }
    const parts = (request.headers.get('x-forwarded-for') ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    const last = parts[parts.length - 1];
    return last ? last.slice(0, 64) : 'unknown';
}
