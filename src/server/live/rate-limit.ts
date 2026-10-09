/**
 * Per-user rate limits for Live writes (chat, questions, likes, claims), on top of slow mode.
 *
 * Same in-memory fixed-window placeholder as Make AI and the Build Graph (per instance,
 * reset on deploy); replace with the shared store when the R2 rate limits move to Redis.
 * Keys are user ids (every Live write is signed in), never IPs.
 */
import { errorResponse } from '../http';
import { FixedWindowRateLimiter } from '../make-ai/rate-limit';

export const LIVE_RATE_LIMITS = {
    chat: { limit: 8, windowMs: 20_000 },
    question: { limit: 6, windowMs: 60_000 },
    like: { limit: 30, windowMs: 60_000 },
    claim: { limit: 10, windowMs: 60_000 },
    vote: { limit: 20, windowMs: 60_000 },
} as const;

export type LiveLimitKind = keyof typeof LIVE_RATE_LIMITS;

const limiters: Record<LiveLimitKind, FixedWindowRateLimiter> = {
    chat: new FixedWindowRateLimiter(LIVE_RATE_LIMITS.chat.limit, LIVE_RATE_LIMITS.chat.windowMs),
    question: new FixedWindowRateLimiter(LIVE_RATE_LIMITS.question.limit, LIVE_RATE_LIMITS.question.windowMs),
    like: new FixedWindowRateLimiter(LIVE_RATE_LIMITS.like.limit, LIVE_RATE_LIMITS.like.windowMs),
    claim: new FixedWindowRateLimiter(LIVE_RATE_LIMITS.claim.limit, LIVE_RATE_LIMITS.claim.windowMs),
    vote: new FixedWindowRateLimiter(LIVE_RATE_LIMITS.vote.limit, LIVE_RATE_LIMITS.vote.windowMs),
};

/** A 429 response (with Retry-After) when the user is over the limit for `kind`, else null. */
export function limitLive(kind: LiveLimitKind, userId: string): Response | null {
    const decision = limiters[kind].hit(userId);
    if (decision.allowed) return null;
    const res = errorResponse('RATE_LIMITED', 'You are going a little fast. Wait a moment and try again.', 429);
    res.headers.set('retry-after', String(decision.retryAfterSeconds));
    return res;
}

/** Tests: clear every window. */
export function resetLiveRateLimits(): void {
    for (const l of Object.values(limiters)) l.reset();
}
