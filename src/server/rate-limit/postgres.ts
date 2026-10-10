/**
 * Postgres-backed rate-limit store: every instance shares `rate_limit_buckets`.
 *
 * Each hit is ONE `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement. The conflict
 * path takes the row lock, so concurrent hits on the same key are serialized by Postgres and
 * can never exceed the limit (no read-modify-write race). All time comes from the caller's
 * `now` so tests can move the clock; the SET expressions see the row as it was before the hit.
 *
 * Keys are stored as sha256(bucket + key): rate limiting never persists a raw IP. Expired rows
 * behave exactly like missing ones and are deleted by `sweepExpired` (run lazily at most once a
 * minute per instance, and exported for a cron).
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db';
import type { RateLimitDecision } from './memory';

export type FixedWindowRule = { kind: 'fixed_window'; limit: number; windowMs: number };
export type TokenBucketRule = { kind: 'token_bucket'; capacity: number; refillPerSecond: number };
export type RateLimitRule = FixedWindowRule | TokenBucketRule;

export const SWEEP_INTERVAL_MS = 60_000;
/** Rows stay this long past expiry before the sweep removes them (clock skew between instances). */
const SWEEP_GRACE_MS = 60_000;
const SWEEP_BATCH = 5_000;

export function keyHash(bucket: string, key: string): string {
    return createHash('sha256').update(`${bucket}\u0000${key}`).digest('hex');
}

type Row = { count: number; tokens: number; allowed: boolean; expires_at: Date | string };

function rows<T>(result: unknown): T[] {
    return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

export async function hitPostgres(bucket: string, key: string, rule: RateLimitRule, now: number, db: DbOrTx = getDb()): Promise<RateLimitDecision> {
    const h = keyHash(bucket, key);
    const at = new Date(now).toISOString();
    if (rule.kind === 'fixed_window') {
        const until = new Date(now + rule.windowMs).toISOString();
        const [row] = rows<Row>(
            await db.execute(sql`
                insert into rate_limit_buckets (bucket, key_hash, count, tokens, allowed, updated_at, expires_at)
                values (${bucket}, ${h}, 1, 0, ${rule.limit >= 1}, ${at}::timestamptz, ${until}::timestamptz)
                on conflict (bucket, key_hash) do update set
                    count = case when rate_limit_buckets.expires_at <= ${at}::timestamptz then 1
                                 when rate_limit_buckets.count >= ${rule.limit} then rate_limit_buckets.count
                                 else rate_limit_buckets.count + 1 end,
                    allowed = rate_limit_buckets.expires_at <= ${at}::timestamptz or rate_limit_buckets.count < ${rule.limit},
                    updated_at = ${at}::timestamptz,
                    expires_at = case when rate_limit_buckets.expires_at <= ${at}::timestamptz then ${until}::timestamptz else rate_limit_buckets.expires_at end
                returning count, tokens, allowed, expires_at`),
        );
        if (!row) throw new Error('rate limit upsert returned no row');
        if (row.allowed) return { allowed: true, remaining: Math.max(0, rule.limit - row.count) };
        const reset = new Date(row.expires_at).getTime();
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((reset - now) / 1000)) };
    }

    const { capacity, refillPerSecond: rate } = rule;
    // A bucket left alone for capacity / rate seconds is full again, i.e. equal to a missing row.
    const until = new Date(now + Math.ceil((capacity / rate) * 1000)).toISOString();
    const refilled = sql`least(${capacity}::double precision, rate_limit_buckets.tokens + greatest(0, extract(epoch from (${at}::timestamptz - rate_limit_buckets.updated_at))) * ${rate}::double precision)`;
    const [row] = rows<Row>(
        await db.execute(sql`
            insert into rate_limit_buckets (bucket, key_hash, count, tokens, allowed, updated_at, expires_at)
            values (${bucket}, ${h}, 0, ${capacity - 1}::double precision, true, ${at}::timestamptz, ${until}::timestamptz)
            on conflict (bucket, key_hash) do update set
                tokens = case when ${refilled} >= 1 then ${refilled} - 1 else ${refilled} end,
                allowed = ${refilled} >= 1,
                updated_at = greatest(rate_limit_buckets.updated_at, ${at}::timestamptz),
                expires_at = ${until}::timestamptz
            returning count, tokens, allowed, expires_at`),
    );
    if (!row) throw new Error('rate limit upsert returned no row');
    if (row.allowed) return { allowed: true, remaining: Math.floor(row.tokens) };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - row.tokens) / rate)) };
}

/** Delete rows expired more than a minute ago. Returns how many were removed. */
export async function sweepExpired(now: number = Date.now(), db: DbOrTx = getDb()): Promise<number> {
    const before = new Date(now - SWEEP_GRACE_MS).toISOString();
    const deleted = rows<{ bucket: string }>(
        await db.execute(sql`
            delete from rate_limit_buckets where ctid in (
                select ctid from rate_limit_buckets where expires_at < ${before}::timestamptz limit ${SWEEP_BATCH}
            ) returning bucket`),
    );
    return deleted.length;
}

export async function resetPostgresBucket(bucket: string, db: DbOrTx = getDb()): Promise<void> {
    await db.execute(sql`delete from rate_limit_buckets where bucket = ${bucket}`);
}
