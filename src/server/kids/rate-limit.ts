/** Kids mode limits (shared limiter, src/server/rate-limit): each design runs the workshop and the quote engine. */
import { ApiError } from '../http';
import { RateLimiter } from '../rate-limit';

export const KID_DESIGN_LIMIT = { limit: 20, windowMs: 10 * 60_000 } as const;
export const kidDesignLimiter = new RateLimiter('kids_design', { kind: 'fixed_window', ...KID_DESIGN_LIMIT });
export const kidAskLimiter = new RateLimiter('kids_ask', { kind: 'fixed_window', limit: 20, windowMs: 60 * 60_000 });

export async function limitKid(limiter: RateLimiter, kidId: string): Promise<void> {
    const d = await limiter.hit(kidId);
    if (!d.allowed) throw new ApiError('RATE_LIMITED', 'Slow down a little. Try again in a few minutes.', 429, { retryAfterSeconds: d.retryAfterSeconds });
}
