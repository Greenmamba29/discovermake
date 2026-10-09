/**
 * Route helpers for the Media API: shared rate limiting with a 429 + Retry-After answer.
 */
import { errorResponse } from '../http';
import { clientIp } from '../make-ai/rate-limit';
import type { Limiter } from '../rate-limit';

/** A 429 response when `key` is over `limiter`'s budget, else null. */
export async function limited(limiter: Pick<Limiter, 'hit'>, key: string, message = 'You are going a little fast. Wait a moment and try again.'): Promise<Response | null> {
    const decision = await limiter.hit(key);
    if (decision.allowed) return null;
    const res = errorResponse('RATE_LIMITED', message, 429);
    res.headers.set('retry-after', String(decision.retryAfterSeconds));
    return res;
}

/** Rate-limit key: the signed-in user, else the client IP. */
export function limitKey(request: Request, userId: string | null | undefined): string {
    return userId ?? `ip:${clientIp(request)}`;
}
