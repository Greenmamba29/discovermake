// Stub: replaced by the R2 accounts module at integration
/**
 * Who is calling (R2 accounts, ADR-0009). This file is a STUB with the exact export
 * signatures of the accounts module, so Live (R4) compiles and runs before accounts land.
 *
 * Outside production only, a request may identify a signed-in user with the test-only
 * header `x-dm-test-user` (Playwright `extraHTTPHeaders`, vitest requests):
 *
 *   x-dm-test-user: id=usr_ada;email=ada@example.com;roles=buyer,creator;name=Ada;handle=ada
 *
 * In production `getViewer` always returns null here (the real module reads `dm_session`).
 */
import type { UserRole, Viewer } from '../../contracts/account';
import { USER_ROLES } from '../../contracts/account';
import { ApiError } from '../http';
import { sha256Hex } from './tokens';

export type ViewerContext = { user: Viewer; sessionId: string };

export const TEST_USER_HEADER = 'x-dm-test-user';

const USER_ID_RE = /^usr_[A-Za-z0-9_-]{2,60}$/;

function parseTestUser(raw: string): ViewerContext | null {
    const fields = new Map<string, string>();
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i <= 0) continue;
        fields.set(part.slice(0, i).trim().toLowerCase(), decodeURIComponent(part.slice(i + 1).trim()));
    }
    const id = fields.get('id') ?? '';
    if (!USER_ID_RE.test(id)) return null;
    const roles = (fields.get('roles') ?? 'buyer')
        .split(',')
        .map((r) => r.trim())
        .filter((r): r is UserRole => (USER_ROLES as readonly string[]).includes(r));
    if (!roles.includes('buyer')) roles.unshift('buyer');
    const handle = fields.get('handle');
    return {
        sessionId: `test_${id}`,
        user: {
            id,
            email: fields.get('email') || `${id}@test.discovermake.local`,
            emailVerified: true,
            displayName: fields.get('name') || null,
            handle: handle && /^[a-z0-9_]{3,24}$/.test(handle) ? handle : null,
            roles,
            onboardedAt: null,
            createdAt: new Date(0).toISOString(),
        },
    };
}

export async function getViewer(request: Request): Promise<ViewerContext | null> {
    if (process.env.NODE_ENV === 'production') return null;
    const raw = request.headers.get(TEST_USER_HEADER);
    if (!raw) return null;
    return parseTestUser(raw);
}

/** ApiError 401 when nobody is signed in. */
export async function requireViewer(request: Request): Promise<ViewerContext> {
    const v = await getViewer(request);
    if (!v) throw new ApiError('UNAUTHORIZED', 'Sign in to continue', 401);
    return v;
}

export function hasRole(v: ViewerContext | null, role: UserRole): boolean {
    return !!v && v.user.roles.includes(role);
}

/** 401 when signed out, 403 without the role. */
export async function requireRole(request: Request, role: UserRole): Promise<ViewerContext> {
    const v = await requireViewer(request);
    if (!hasRole(v, role)) throw new ApiError('FORBIDDEN', `This needs the ${role} role`, 403);
    return v;
}

/** sha256 of the guest device cookie (`dm_device`), or null when the browser has none. */
export function getDeviceHash(request: Request): string | null {
    const cookie = request.headers.get('cookie') ?? '';
    const m = /(?:^|;\s*)dm_device=([^;]+)/.exec(cookie);
    return m ? sha256Hex(decodeURIComponent(m[1])) : null;
}

export async function assertCanEditBuild(request: Request, build: { id: string; ownerUserId: string | null; deviceHash: string | null }): Promise<void> {
    if (!build.ownerUserId && !build.deviceHash) return;
    const v = await getViewer(request);
    if (build.ownerUserId && v?.user.id === build.ownerUserId) return;
    if (build.deviceHash && getDeviceHash(request) === build.deviceHash) return;
    throw new ApiError('FORBIDDEN', 'Only the owner can change this build', 403);
}
