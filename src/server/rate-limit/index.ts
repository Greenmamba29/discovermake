/**
 * Shared rate limiting (Stage 1 hardening; replaces the per-instance placeholders).
 *
 *   const limiter = new RateLimiter('make_ai_ip', { kind: 'fixed_window', limit: 10, windowMs: 60_000 });
 *   const decision = await limiter.hit(clientIp(request));   // { allowed, remaining } | { allowed: false, retryAfterSeconds }
 *
 * Store, chosen per hit from RATE_LIMIT_STORE:
 *   postgres  `rate_limit_buckets`, one atomic upsert per hit, shared by every instance
 *             (default when NODE_ENV=production)
 *   memory    per-instance maps (default in development and tests)
 * Both stores implement the same two algorithms (fixed window, token bucket) with the same
 * decisions; tests/rate-limit pins that.
 */
import { env } from '../env';
import { FixedWindowRateLimiter, TokenBucketRateLimiter, type RateLimitDecision } from './memory';
import { hitPostgres, resetPostgresBucket, sweepExpired, SWEEP_INTERVAL_MS, type RateLimitRule } from './postgres';

export { FixedWindowRateLimiter, TokenBucketRateLimiter, type RateLimitDecision } from './memory';
export { keyHash, sweepExpired, type FixedWindowRule, type RateLimitRule, type TokenBucketRule } from './postgres';

export type RateLimitStoreName = 'postgres' | 'memory';

export function rateLimitStore(): RateLimitStoreName {
    const configured = env().RATE_LIMIT_STORE;
    if (configured) return configured;
    return env().NODE_ENV === 'production' ? 'postgres' : 'memory';
}

const globalForSweep = globalThis as unknown as { __dmRateLimitSweepAt?: number };

/** Lazy cleanup of stale keys: at most one sweep per instance per minute, never blocking a hit. */
function maybeSweep(now: number): void {
    const last = globalForSweep.__dmRateLimitSweepAt ?? 0;
    if (now - last < SWEEP_INTERVAL_MS) return;
    globalForSweep.__dmRateLimitSweepAt = now;
    sweepExpired(now).catch((err) => console.warn('[rate-limit] sweep failed', err instanceof Error ? err.message : err));
}

export interface Limiter {
    hit(key: string, now?: number): Promise<RateLimitDecision>;
    reset(): Promise<void>;
}

export class RateLimiter implements Limiter {
    private readonly memory: { hit: (key: string, now: number) => RateLimitDecision; reset: () => void };

    /** `name` identifies the bucket family in the shared table: keep it stable and unique. */
    constructor(
        readonly name: string,
        readonly rule: RateLimitRule,
        private readonly storeOverride?: RateLimitStoreName,
    ) {
        if (rule.kind === 'fixed_window') {
            const m = new FixedWindowRateLimiter(rule.limit, rule.windowMs);
            this.memory = { hit: (k, n) => m.hit(k, n), reset: () => m.reset() };
        } else {
            const m = new TokenBucketRateLimiter(rule.capacity, rule.refillPerSecond);
            this.memory = { hit: (k, n) => m.take(k, n), reset: () => m.reset() };
        }
    }

    get store(): RateLimitStoreName {
        return this.storeOverride ?? rateLimitStore();
    }

    async hit(key: string, now: number = Date.now()): Promise<RateLimitDecision> {
        if (this.store === 'memory') return this.memory.hit(key, now);
        maybeSweep(now);
        return hitPostgres(this.name, key, this.rule, now);
    }

    /** Token-bucket spelling of `hit` (the MCP limiter used `take`). */
    take(key: string, now?: number): Promise<RateLimitDecision> {
        return this.hit(key, now);
    }

    /** Forget every key of this limiter (tests and ops). */
    async reset(): Promise<void> {
        this.memory.reset();
        if (this.store === 'postgres') await resetPostgresBucket(this.name);
    }
}

/** A per-key limiter plus an instance-wide (now fleet-wide) budget: both must allow the request. */
export class CompositeRateLimiter implements Limiter {
    static readonly GLOBAL_KEY = '*';

    constructor(
        private readonly perKey: Limiter,
        private readonly global: Limiter,
    ) {}

    async hit(key: string, now: number = Date.now()): Promise<RateLimitDecision> {
        const own = await this.perKey.hit(key, now);
        if (!own.allowed) return own;
        return this.global.hit(CompositeRateLimiter.GLOBAL_KEY, now);
    }

    async reset(): Promise<void> {
        await Promise.all([this.perKey.reset(), this.global.reset()]);
    }
}
