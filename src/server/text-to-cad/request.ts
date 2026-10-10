/**
 * Rate limits for "Make it in 3D" on the shared store (src/server/rate-limit: Postgres in
 * production, memory in dev/test). One make is up to three model calls and three sandboxed
 * builds, so the budget is per ten minutes, per IP and fleet-wide.
 */
import { CompositeRateLimiter, RateLimiter } from '../rate-limit';

export const MAKE_IT_3D_RATE_LIMIT = { perIp: 6, global: 60, windowMs: 10 * 60_000 } as const;

export const makeIt3dLimiter = new CompositeRateLimiter(
    new RateLimiter('make_it_3d_ip', { kind: 'fixed_window', limit: MAKE_IT_3D_RATE_LIMIT.perIp, windowMs: MAKE_IT_3D_RATE_LIMIT.windowMs }),
    new RateLimiter('make_it_3d_global', { kind: 'fixed_window', limit: MAKE_IT_3D_RATE_LIMIT.global, windowMs: MAKE_IT_3D_RATE_LIMIT.windowMs }),
);

export const MAKE_IT_3D_RATE_LIMIT_MESSAGE = 'You have asked for a lot of 3D models in a short time. Wait a few minutes and try again.';
