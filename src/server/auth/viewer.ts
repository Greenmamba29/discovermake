/**
 * Who is calling (ADR-0009). Route handlers use these helpers; nothing else reads the
 * account cookies directly.
 *
 *   const viewer = await getViewer(request);          // ViewerContext | null (signed out)
 *   const viewer = await requireViewer(request);      // 401 when signed out
 *   await requireRole(request, 'ops');                // 401 / 403
 *   await assertCanEditBuild(request, build);         // 403 unless the caller may change the build
 *   const owner = buildOwnerFor(request, response);   // stamp new builds (sets dm_device when missing)
 *
 * Build edit rules:
 *   - `owner_user_id` set -> the signed-in owner, or an ops/admin user;
 *   - else `device_hash` set -> the same device, the signed-in user who has used that
 *     device (a session was created on it), or ops/admin;
 *   - neither (legacy R1 builds) -> anyone holding the unguessable id (ADR-0008).
 */
import { and, eq } from 'drizzle-orm';
import type { NextResponse } from 'next/server';
import type { UserRole, Viewer } from '../../contracts/account';
import { getDb } from '../db';
import { userSessions } from '../db/schema';
import { ApiError } from '../http';
import { assertSameOrigin } from './cookies';
import { applyDevice, ensureDevice, getDeviceHash, resolveDevice } from './device';
import { readSessionSecret, resolveSession, setSessionCookie, type ResolvedSession } from './sessions';
import { toViewer } from './users';

export { assertSameOrigin } from './cookies';
export { applyDevice, ensureDevice, getDeviceHash, resolveDevice } from './device';

export type ViewerContext = { user: Viewer; sessionId: string };

/** Per-request memo so several helpers in one handler resolve the session once. */
const resolved = new WeakMap<Request, Promise<ResolvedSession | null>>();

function resolveForRequest(request: Request): Promise<ResolvedSession | null> {
    let p = resolved.get(request);
    if (!p) {
        p = resolveSession(readSessionSecret(request));
        resolved.set(request, p);
    }
    return p;
}

/** The signed-in user, or null (no / unknown / expired / revoked session). */
export async function getViewer(request: Request): Promise<ViewerContext | null> {
    const r = await resolveForRequest(request);
    return r ? { user: toViewer(r.user), sessionId: r.session.id } : null;
}

export async function requireViewer(request: Request): Promise<ViewerContext> {
    const viewer = await getViewer(request);
    if (!viewer) throw new ApiError('UNAUTHORIZED', 'Sign in to continue.', 401);
    return viewer;
}

export function hasRole(v: ViewerContext | null, role: UserRole): boolean {
    return !!v && v.user.roles.includes(role);
}

/** ops and admin may act on any build or order. */
export function isStaff(v: ViewerContext | null): boolean {
    return hasRole(v, 'ops') || hasRole(v, 'admin');
}

export async function requireRole(request: Request, role: UserRole): Promise<ViewerContext> {
    const viewer = await requireViewer(request);
    if (!hasRole(viewer, role)) throw new ApiError('FORBIDDEN', 'Your account does not have access to this.', 403);
    return viewer;
}

/**
 * When the session's expiry slid during this request, re-send the cookie with the new
 * expiry so the browser keeps it as long as the server does.
 */
export async function applySessionRefresh(request: Request, response: NextResponse): Promise<void> {
    const r = await resolveForRequest(request);
    const secret = readSessionSecret(request);
    if (r?.refreshed && secret) setSessionCookie(response, secret, r.session.expiresAt);
}

export type BuildOwnership = { id: string; ownerUserId: string | null; deviceHash: string | null };

/** Has this user signed in on the device with this hash? */
async function userUsedDevice(userId: string, deviceHash: string): Promise<boolean> {
    const [row] = await getDb()
        .select({ id: userSessions.id })
        .from(userSessions)
        .where(and(eq(userSessions.userId, userId), eq(userSessions.deviceHash, deviceHash)))
        .limit(1);
    return !!row;
}

/** Pure-ish decision used by assertCanEditBuild and server pages (no throw). */
export async function canEditBuild(principal: { viewer: ViewerContext | null; deviceHash: string | null }, build: BuildOwnership): Promise<boolean> {
    const { viewer, deviceHash } = principal;
    if (isStaff(viewer)) return true;
    if (build.ownerUserId) return viewer?.user.id === build.ownerUserId;
    if (build.deviceHash) {
        if (deviceHash && deviceHash === build.deviceHash) return true;
        return viewer ? userUsedDevice(viewer.user.id, build.deviceHash) : false;
    }
    return true; // legacy R1 build: the unguessable id is the capability (ADR-0008)
}

export const NOT_BUILD_OWNER_MESSAGE = 'Only the owner of this build can change it. Sign in with the account that made it, or remix it to make your own copy.';

/** 403 unless the caller may change `build` (see the module comment). Also rejects cross-origin requests. */
export async function assertCanEditBuild(request: Request, build: BuildOwnership): Promise<void> {
    assertSameOrigin(request);
    const viewer = await getViewer(request);
    if (!(await canEditBuild({ viewer, deviceHash: getDeviceHash(request) }, build))) {
        throw new ApiError('FORBIDDEN', NOT_BUILD_OWNER_MESSAGE, 403);
    }
}

export type BuildOwner = { ownerUserId: string | null; deviceHash: string };

/**
 * Ownership stamp for a build created by this request: the signed-in user (if any) plus
 * the device. Sets the `dm_device` cookie on `response` when the browser had none.
 */
export async function buildOwnerFor(request: Request, response: NextResponse): Promise<BuildOwner> {
    const viewer = await getViewer(request);
    return { ownerUserId: viewer?.user.id ?? null, deviceHash: ensureDevice(request, response) };
}

/**
 * Two-phase variant for handlers that create the response after the build: resolve the
 * owner first, then `apply(response)` to persist a newly minted device cookie.
 */
export async function resolveBuildOwner(request: Request): Promise<BuildOwner & { apply: (response: NextResponse) => void }> {
    const viewer = await getViewer(request);
    const device = resolveDevice(request);
    return { ownerUserId: viewer?.user.id ?? null, deviceHash: device.hash, apply: (response) => applyDevice(response, device) };
}
