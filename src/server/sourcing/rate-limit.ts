/**
 * Per-client token bucket for MCP tool calls.
 *
 * PLACEHOLDER for R2: in-memory, so each server instance keeps its own buckets and
 * they reset on deploy. One Accio Work workspace polling every 15 minutes is far
 * below the budget; before running more than one instance (or more clients) this
 * MUST move to a shared store (Postgres row per client, Redis, or a WAF rule).
 */
import { MCP_RATE_LIMIT } from './constants';

type Bucket = { tokens: number; updatedAt: number };

export type BucketDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

const MAX_TRACKED_KEYS = 10_000;

export class TokenBucketRateLimiter {
    private readonly buckets = new Map<string, Bucket>();

    constructor(
        private readonly capacity: number,
        private readonly refillPerSecond: number,
    ) {}

    take(key: string, now: number = Date.now()): BucketDecision {
        let b = this.buckets.get(key);
        if (!b) {
            if (this.buckets.size >= MAX_TRACKED_KEYS) this.buckets.clear();
            b = { tokens: this.capacity, updatedAt: now };
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

export const mcpRateLimiter = new TokenBucketRateLimiter(MCP_RATE_LIMIT.capacity, MCP_RATE_LIMIT.refillPerSecond);
