/**
 * Ops/admin auth for R1 (ADR-0008): a single ADMIN_TOKEN presented as
 * `Authorization: Bearer <ADMIN_TOKEN>`. Supabase Auth roles replace this in R2.
 */
import { env } from '../env';
import { ApiError } from '../http';
import { bearerToken, safeEqual } from './tokens';

export const ADMIN_ACTOR = { kind: 'admin', id: 'ops' } as const;

export function isAdminRequest(request: Request): boolean {
    const expected = env().ADMIN_TOKEN;
    if (!expected) return false; // admin API disabled when unset
    const presented = bearerToken(request.headers);
    return !!presented && safeEqual(presented, expected);
}

/** Throws ApiError(401) unless the request carries the admin bearer token. */
export function requireAdmin(request: Request): void {
    if (!isAdminRequest(request)) {
        throw new ApiError('UNAUTHORIZED', 'Admin token required', 401);
    }
}

/**
 * Scheduled-job routes (offer expiry, outbox publish) accept the admin token OR the
 * narrower CRON_SECRET, so the scheduler never needs full admin rights.
 */
export function requireAdminOrCron(request: Request): void {
    if (isAdminRequest(request)) return;
    const cron = env().CRON_SECRET;
    const presented = bearerToken(request.headers);
    if (cron && presented && safeEqual(presented, cron)) return;
    throw new ApiError('UNAUTHORIZED', 'Admin token or cron secret required', 401);
}
