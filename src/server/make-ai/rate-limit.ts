/**
 * Per-IP fixed-window rate limit for Make AI intake.
 *
 * PLACEHOLDER: in-memory, so each server instance counts separately and counts reset on
 * deploy. Good enough to stop a single client hammering a paid model from one instance;
 * replace with a shared store (Postgres / Redis / Vercel WAF rule) before Make AI is public.
 * IPs live only in this map (never logged or persisted) and expire with their window.
 */
export const MAKE_AI_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

/** Stop the map growing without bound under a spray of spoofed IPs. */
const MAX_TRACKED_KEYS = 10_000;

type Window = { count: number; resetAt: number };

export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export class FixedWindowRateLimiter {
    private readonly windows = new Map<string, Window>();

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
    ) {}

    hit(key: string, now: number = Date.now()): RateLimitDecision {
        let w = this.windows.get(key);
        if (!w || w.resetAt <= now) {
            if (!w && this.windows.size >= MAX_TRACKED_KEYS) this.sweep(now);
            w = { count: 0, resetAt: now + this.windowMs };
            this.windows.set(key, w);
        }
        if (w.count >= this.limit) {
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
        }
        w.count++;
        return { allowed: true, remaining: this.limit - w.count };
    }

    reset(): void {
        this.windows.clear();
    }

    private sweep(now: number): void {
        for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
        // Still full (all windows live): drop the oldest entries rather than grow.
        const excess = this.windows.size - MAX_TRACKED_KEYS + 1;
        if (excess > 0) {
            let dropped = 0;
            for (const k of this.windows.keys()) {
                if (dropped++ >= excess) break;
                this.windows.delete(k);
            }
        }
    }
}

/**
 * Instance-wide cap across all IPs: bounds model spend even when a client rotates
 * (spoofed) IPs to dodge the per-IP limit.
 */
export const MAKE_AI_GLOBAL_RATE_LIMIT = { limit: 120, windowMs: 60_000 } as const;
const GLOBAL_KEY = '*';

/** Per-IP limiter plus an instance-wide budget; both must allow the request. */
export class MakeAiRateLimiter {
    constructor(
        private readonly perIp: FixedWindowRateLimiter,
        private readonly global: FixedWindowRateLimiter,
    ) {}

    hit(ip: string, now: number = Date.now()): RateLimitDecision {
        const own = this.perIp.hit(ip, now);
        if (!own.allowed) return own;
        return this.global.hit(GLOBAL_KEY, now);
    }

    reset(): void {
        this.perIp.reset();
        this.global.reset();
    }
}

export const makeAiRateLimiter = new MakeAiRateLimiter(
    new FixedWindowRateLimiter(MAKE_AI_RATE_LIMIT.limit, MAKE_AI_RATE_LIMIT.windowMs),
    new FixedWindowRateLimiter(MAKE_AI_GLOBAL_RATE_LIMIT.limit, MAKE_AI_GLOBAL_RATE_LIMIT.windowMs),
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
