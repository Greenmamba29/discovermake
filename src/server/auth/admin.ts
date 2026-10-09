/**
 * Ops/admin auth (ADR-0008, extended by ADR-0009).
 *
 * `/api/admin/*` accepts either:
 *   - `Authorization: Bearer <ADMIN_TOKEN>` (constant-time; disabled when unset), or
 *   - a signed-in `dm_session` whose user has the `ops` or `admin` role (cross-origin
 *     requests rejected, since this path is cookie-authenticated).
 * Scheduled-job routes also accept `Authorization: Bearer <CRON_SECRET>` (and nothing else does).
 *
 * Both guards are async: always `await requireAdmin(request)`.
 * (tests/accounts/admin-guards.test.ts fails on any un-awaited call under src/app/api.)
 */
import type { Actor } from '../../contracts/common';
import { env } from '../env';
import { ApiError } from '../http';
import { assertSameOrigin } from './cookies';
import { bearerToken, safeEqual } from './tokens';
import { getViewer, isStaff } from './viewer';

export const ADMIN_ACTOR = { kind: 'admin', id: 'ops' } as const;

export function isAdminRequest(request: Request): boolean {
    const expected = env().ADMIN_TOKEN;
    if (!expected) return false; // admin token disabled when unset
    const presented = bearerToken(request.headers);
    return !!presented && safeEqual(presented, expected);
}

/** Who passed the admin guard: the shared token, or a signed-in staff user. */
export type AdminPrincipal = { via: 'token'; actor: Actor } | { via: 'session'; actor: Actor; userId: string };

/** The admin principal for this request, or null. */
export async function resolveAdmin(request: Request): Promise<AdminPrincipal | null> {
    if (isAdminRequest(request)) return { via: 'token', actor: ADMIN_ACTOR };
    if (bearerToken(request.headers)) return null; // a wrong bearer never falls back to cookies
    const viewer = await getViewer(request);
    if (!viewer || !isStaff(viewer)) return null;
    assertSameOrigin(request);
    return { via: 'session', actor: { kind: 'admin', id: viewer.user.id }, userId: viewer.user.id };
}

/** Throws ApiError(401) unless the request carries the admin token or an ops/admin session. */
export async function requireAdmin(request: Request): Promise<AdminPrincipal> {
    const principal = await resolveAdmin(request);
    if (!principal) throw new ApiError('UNAUTHORIZED', 'Admin token or an ops sign-in required', 401);
    return principal;
}

/**
 * Scheduled-job routes (offer expiry, outbox publish) accept admin access OR the
 * narrower CRON_SECRET, so the scheduler never needs full admin rights.
 */
export async function requireAdminOrCron(request: Request): Promise<void> {
    const cron = env().CRON_SECRET;
    const presented = bearerToken(request.headers);
    if (cron && presented && safeEqual(presented, cron)) return;
    if (await resolveAdmin(request)) return;
    throw new ApiError('UNAUTHORIZED', 'Admin token or cron secret required', 401);
}
