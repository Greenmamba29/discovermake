/**
 * In-process rate-limit algorithms (the `memory` store, and the reference behaviour the
 * Postgres store mirrors). Per instance only: counts reset on deploy and are not shared
 * between instances, so production uses RATE_LIMIT_STORE=postgres (see ./index.ts).
 * Keys live only in these maps and expire with their window or bucket.
 */

export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

/** Stop the maps growing without bound under a spray of spoofed keys. */
const MAX_TRACKED_KEYS = 10_000;

type Window = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
    private readonly windows = new Map<string, Window>();

    constructor(
        readonly limit: number,
        readonly windowMs: number,
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

type Bucket = { tokens: number; updatedAt: number };

export class TokenBucketRateLimiter {
    private readonly buckets = new Map<string, Bucket>();

    constructor(
        readonly capacity: number,
        readonly refillPerSecond: number,
        private readonly maxKeys: number = MAX_TRACKED_KEYS,
    ) {}

    take(key: string, now: number = Date.now()): RateLimitDecision {
        let b = this.buckets.get(key);
        if (!b) {
            // Evict the least recently used keys (Map iterates in insertion order and we
            // re-insert on every hit), never everyone's state at once.
            while (this.buckets.size >= this.maxKeys) {
                const oldest = this.buckets.keys().next().value;
                if (oldest === undefined) break;
                this.buckets.delete(oldest);
            }
            b = { tokens: this.capacity, updatedAt: now };
            this.buckets.set(key, b);
        } else if (this.buckets.size > 1) {
            // Move to the end of the iteration order (most recently used).
            this.buckets.delete(key);
            this.buckets.set(key, b);
        }
        const elapsed = Math.max(0, now - b.updatedAt) / 1000;
        b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
        b.updatedAt = now;
        if (b.tokens < 1) {
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerSecond)) };
        }
        b.tokens -= 1;
        return { allowed: true, remaining: Math.floor(b.tokens) };
    }

    reset(): void {
        this.buckets.clear();
    }
}
