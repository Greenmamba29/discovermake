/**
 * Per-IP fixed-window rate limit for Make AI intake, plus a fleet-wide budget.
 *
 * Backed by the shared limiter (src/server/rate-limit): Postgres in production, so every
 * instance counts against the same windows; per-instance memory in development and tests.
 * Keys are stored hashed and expire with their window (an IP is never logged or persisted raw).
 */
import { env } from '../env';
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
 * Client IP for rate limits and the MCP CIDR allowlist. Only headers that the deployment's
 * proxy overwrites are trusted, chosen by TRUSTED_PROXY (default: `vercel` on Vercel, else `xff`):
 *   vercel  - `x-vercel-forwarded-for` (Vercel overwrites it), else the rightmost XFF hop;
 *   real-ip - `x-real-ip` set by our own nginx/ingress, else the rightmost XFF hop;
 *   xff     - the rightmost `x-forwarded-for` hop, the one our nearest proxy appended;
 *   none    - no proxy in front: no header is trusted and the IP is 'unknown'.
 * A client can prepend any XFF value it likes but cannot change what our proxy appends,
 * and it can never choose which header we read.
 */
export function clientIp(request: Request): string {
    const mode = trustedProxyMode();
    if (mode === 'none') return 'unknown';
    const header = mode === 'vercel' ? 'x-vercel-forwarded-for' : mode === 'real-ip' ? 'x-real-ip' : null;
    if (header) {
        const v = request.headers.get(header)?.split(',')[0]?.trim();
        if (v) return v.slice(0, 64);
    }
    const parts = (request.headers.get('x-forwarded-for') ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    const last = parts[parts.length - 1];
    return last ? last.slice(0, 64) : 'unknown';
}

export type TrustedProxyMode = 'vercel' | 'real-ip' | 'xff' | 'none';

export function trustedProxyMode(): TrustedProxyMode {
    const configured = env().TRUSTED_PROXY;
    if (configured) return configured;
    return process.env.VERCEL ? 'vercel' : 'xff';
}
