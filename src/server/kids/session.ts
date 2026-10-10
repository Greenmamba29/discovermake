/**
 * Who is using Kids mode, and the guard for everything a kid may not do.
 *
 *   const kid = await requireKidSession(request);   // 401 unless a live kid session
 *   await assertNotKidMode(request);                 // 403 in Kids mode (checkout, cart, account, ...)
 *
 * A kid session needs all of: a correctly signed `dm_kid` cookie, the grown-up's `dm_session`
 * resolving to the session named in it, a `kid_mode_locks` row for that session and kid, and the
 * kid profile still existing under that grown-up. Everything a kid route reads is scoped by the
 * kid id and grown-up id from this context, never by ids in the request alone.
 */
import { and, eq } from 'drizzle-orm';
import { KIDS_MODE_FORBIDDEN_MESSAGE } from '@/lib/kids/policy';
import { resolveSessionWithKidLock } from '../auth/viewer';
import { getDb } from '../db';
import { kidProfiles, users } from '../db/schema';
import { ApiError } from '../http';
import { readKidCookie, verifyKidCookie, type KidCookieClaims } from './cookie';
import { findSessionLock } from './lock';

export type KidProfileRow = typeof kidProfiles.$inferSelect;

export type KidSession = {
    kid: KidProfileRow;
    ownerUserId: string;
    /** The grown-up's account email (notifications go here, never to the kid). */
    ownerEmail: string;
    sessionId: string;
};

/** What the request is, for Kids mode purposes. */
export type KidModeState =
    | { kind: 'none' }
    /** A live kid session. */
    | { kind: 'active'; session: KidSession }
    /** Kids mode cookie or lock present but no live kid session (profile deleted, tampered cookie, ...). */
    | { kind: 'ended'; ownerUserId: string | null; sessionId: string | null; claims: KidCookieClaims | null };

const memo = new WeakMap<Request, Promise<KidModeState>>();

export function kidModeState(request: Request): Promise<KidModeState> {
    let p = memo.get(request);
    if (!p) {
        p = computeState(request);
        memo.set(request, p);
    }
    return p;
}

async function computeState(request: Request): Promise<KidModeState> {
    const raw = readKidCookie(request);
    const session = await resolveSessionWithKidLock(request);
    if (!raw && !session?.kidLocked) return { kind: 'none' };
    const claims = verifyKidCookie(raw);
    const lock = session ? await findSessionLock(session.session.id) : null;
    const ended = (): KidModeState => ({ kind: 'ended', ownerUserId: lock?.ownerUserId ?? claims?.o ?? null, sessionId: session?.session.id ?? null, claims });
    if (!claims || !session || !lock) return ended();
    if (claims.s !== session.session.id || lock.kidId !== claims.k || lock.ownerUserId !== claims.o || session.user.id !== claims.o) return ended();
    const db = getDb();
    const [kid] = await db
        .select()
        .from(kidProfiles)
        .where(and(eq(kidProfiles.id, claims.k), eq(kidProfiles.ownerUserId, claims.o)))
        .limit(1);
    if (!kid) return ended();
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, claims.o)).limit(1);
    if (!owner) return ended();
    return { kind: 'active', session: { kid, ownerUserId: claims.o, ownerEmail: owner.email, sessionId: session.session.id } };
}

export async function getKidSession(request: Request): Promise<KidSession | null> {
    const state = await kidModeState(request);
    return state.kind === 'active' ? state.session : null;
}

export async function requireKidSession(request: Request): Promise<KidSession> {
    const kid = await getKidSession(request);
    if (!kid) throw new ApiError('UNAUTHORIZED', 'Kids mode has ended. Ask a grown-up to start it again.', 401);
    return kid;
}

/** True while this browser is in Kids mode (cookie present, or the grown-up's session is locked). */
export async function isKidMode(request: Request): Promise<boolean> {
    return (await kidModeState(request)).kind !== 'none';
}

/**
 * The server-side guard for kid-forbidden features (checkout, cart, account settings, studio,
 * sourcing, admin, shop, uploads, Make AI free text, Live chat and questions, Reconstruct photo
 * capture, publishing). The proxy refuses these routes too; this holds even without it.
 */
export async function assertNotKidMode(request: Request): Promise<void> {
    if (await isKidMode(request)) throw new ApiError('FORBIDDEN', KIDS_MODE_FORBIDDEN_MESSAGE, 403);
}
