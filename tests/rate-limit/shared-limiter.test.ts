/**
 * Shared rate limiting (Stage 1 hardening): the Postgres store gives the same decisions as the
 * in-memory algorithms, holds under concurrency (one atomic upsert per hit), resets with its
 * window, is shared across limiter instances (= server instances), never stores the raw key,
 * and sweeps stale rows.
 */
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CompositeRateLimiter, keyHash, RateLimiter, rateLimitStore, sweepExpired, type RateLimitRule } from '@/server/rate-limit';
import { resetEnvCache } from '@/server/env';
import { useTestDb as withTestDb } from '../support/db';

const ctx = withTestDb();
const T0 = Date.parse('2026-10-09T12:00:00.000Z');
const FIXED: RateLimitRule = { kind: 'fixed_window', limit: 3, windowMs: 60_000 };
const BUCKET: RateLimitRule = { kind: 'token_bucket', capacity: 3, refillPerSecond: 1 };
let seq = 0;
const name = (p: string) => `${p}_${++seq}`;

afterEach(() => {
    delete process.env.RATE_LIMIT_STORE;
    resetEnvCache();
});

describe.each(['memory', 'postgres'] as const)('%s store', (store) => {
    it('fixed window: allows the limit, refuses with Retry-After, resets with the window', async () => {
        const rl = new RateLimiter(name('fw'), FIXED, store);
        const got = [];
        for (let i = 0; i < 3; i++) got.push(await rl.hit('198.51.100.1', T0 + i));
        expect(got.map((d) => d.allowed)).toEqual([true, true, true]);
        expect(got[2]).toEqual({ allowed: true, remaining: 0 });
        expect(await rl.hit('198.51.100.1', T0 + 10_000)).toEqual({ allowed: false, retryAfterSeconds: 50 });
        expect((await rl.hit('198.51.100.2', T0 + 10_000)).allowed).toBe(true); // other keys are independent
        expect(await rl.hit('198.51.100.1', T0 + 60_000)).toEqual({ allowed: true, remaining: 2 }); // new window
    });

    it('token bucket: spends the capacity, then refills at the rate', async () => {
        const rl = new RateLimiter(name('tb'), BUCKET, store);
        for (let i = 0; i < 3; i++) expect((await rl.hit('scl_a', T0)).allowed).toBe(true);
        expect(await rl.hit('scl_a', T0)).toEqual({ allowed: false, retryAfterSeconds: 1 });
        expect((await rl.hit('scl_a', T0 + 1000)).allowed).toBe(true);
        expect((await rl.hit('scl_a', T0 + 1000)).allowed).toBe(false);
        expect(await rl.hit('scl_a', T0 + 60_000)).toEqual({ allowed: true, remaining: 2 }); // full again, never above capacity
    });

    it('reset() forgets every key of that limiter only', async () => {
        const a = new RateLimiter(name('ra'), FIXED, store);
        const b = new RateLimiter(name('rb'), FIXED, store);
        for (let i = 0; i < 3; i++) {
            await a.hit('k', T0);
            await b.hit('k', T0);
        }
        await a.reset();
        expect((await a.hit('k', T0)).allowed).toBe(true);
        expect((await b.hit('k', T0)).allowed).toBe(false);
    });

    it('composite: the per-key limit and the global budget must both allow', async () => {
        const rl = new CompositeRateLimiter(new RateLimiter(name('ip'), { kind: 'fixed_window', limit: 10, windowMs: 60_000 }, store), new RateLimiter(name('all'), FIXED, store));
        for (const ip of ['a', 'b', 'c']) expect((await rl.hit(ip, T0)).allowed).toBe(true);
        expect((await rl.hit('d', T0)).allowed).toBe(false);
    });
});

describe('postgres store', () => {
    it('never lets parallel requests exceed a fixed-window limit', async () => {
        const rl = new RateLimiter(name('race_fw'), { kind: 'fixed_window', limit: 10, windowMs: 60_000 }, 'postgres');
        const results = await Promise.all(Array.from({ length: 60 }, () => rl.hit('203.0.113.7', T0)));
        expect(results.filter((r) => r.allowed)).toHaveLength(10);
    });

    it('never lets parallel requests exceed a token bucket, even across instances', async () => {
        const bucket = name('race_tb');
        // Two limiter objects with the same name stand in for two server instances.
        const one = new RateLimiter(bucket, { kind: 'token_bucket', capacity: 7, refillPerSecond: 0.001 }, 'postgres');
        const two = new RateLimiter(bucket, { kind: 'token_bucket', capacity: 7, refillPerSecond: 0.001 }, 'postgres');
        const results = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? one : two).hit('scl_shared', T0)));
        expect(results.filter((r) => r.allowed)).toHaveLength(7);
    });

    it('stores only a hash of the key, and sweeps rows that expired', async () => {
        const bucket = name('priv');
        const rl = new RateLimiter(bucket, { kind: 'fixed_window', limit: 5, windowMs: 1000 }, 'postgres');
        await rl.hit('192.0.2.55', T0);
        const rows = (await ctx.db.execute(sql`select key_hash from rate_limit_buckets where bucket = ${bucket}`)) as unknown as { key_hash: string }[];
        expect(rows.map((r) => r.key_hash)).toEqual([keyHash(bucket, '192.0.2.55')]);
        expect(JSON.stringify(rows)).not.toContain('192.0.2.55');
        const removed = await sweepExpired(T0 + 1000 + 61_000);
        expect(removed).toBeGreaterThanOrEqual(1);
        const left = (await ctx.db.execute(sql`select count(*)::int as n from rate_limit_buckets where bucket = ${bucket}`)) as unknown as { n: number }[];
        expect(left[0]!.n).toBe(0);
    });
});

describe('RATE_LIMIT_STORE', () => {
    it('defaults to memory outside production and postgres in production, and honours the override', () => {
        const node = process.env.NODE_ENV;
        try {
            delete process.env.RATE_LIMIT_STORE;
            resetEnvCache();
            expect(rateLimitStore()).toBe('memory');
            (process.env as Record<string, string>).NODE_ENV = 'production';
            resetEnvCache();
            expect(rateLimitStore()).toBe('postgres');
            process.env.RATE_LIMIT_STORE = 'memory';
            resetEnvCache();
            expect(rateLimitStore()).toBe('memory');
        } finally {
            (process.env as Record<string, string | undefined>).NODE_ENV = node;
            resetEnvCache();
        }
    });

    it('routes a limiter without an explicit store to the configured one', async () => {
        process.env.RATE_LIMIT_STORE = 'postgres';
        resetEnvCache();
        const bucket = name('cfg');
        const rl = new RateLimiter(bucket, FIXED);
        expect(rl.store).toBe('postgres');
        await rl.hit('x', T0);
        const rows = (await ctx.db.execute(sql`select count(*)::int as n from rate_limit_buckets where bucket = ${bucket}`)) as unknown as { n: number }[];
        expect(rows[0]!.n).toBe(1);
    });
});
