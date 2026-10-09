/**
 * Per-user rate limits for Live writes (chat, questions, likes, claims), on top of slow mode.
 *
 * Shared store (src/server/rate-limit: Postgres in production, memory in dev/test), so the
 * limits hold across instances. Keys are user ids (every Live write is signed in), never IPs.
 */
import { errorResponse } from '../http';
import { RateLimiter } from '../rate-limit';

export const LIVE_RATE_LIMITS = {
    chat: { limit: 8, windowMs: 20_000 },
    question: { limit: 6, windowMs: 60_000 },
    like: { limit: 30, windowMs: 60_000 },
    claim: { limit: 10, windowMs: 60_000 },
    vote: { limit: 20, windowMs: 60_000 },
} as const;

export type LiveLimitKind = keyof typeof LIVE_RATE_LIMITS;

const limiters = Object.fromEntries(
    (Object.keys(LIVE_RATE_LIMITS) as LiveLimitKind[]).map((kind) => [
        kind,
        new RateLimiter(`live_${kind}`, { kind: 'fixed_window', limit: LIVE_RATE_LIMITS[kind].limit, windowMs: LIVE_RATE_LIMITS[kind].windowMs }),
    ]),
) as Record<LiveLimitKind, RateLimiter>;

/** A 429 response (with Retry-After) when the user is over the limit for `kind`, else null. */
export async function limitLive(kind: LiveLimitKind, userId: string): Promise<Response | null> {
    const decision = await limiters[kind].hit(userId);
    if (decision.allowed) return null;
    const res = errorResponse('RATE_LIMITED', 'You are going a little fast. Wait a moment and try again.', 429);
    res.headers.set('retry-after', String(decision.retryAfterSeconds));
    return res;
}

/** Tests: clear every window. */
export async function resetLiveRateLimits(): Promise<void> {
    await Promise.all(Object.values(limiters).map((l) => l.reset()));
}
