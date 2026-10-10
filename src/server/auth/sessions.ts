/**
 * Account sessions (ADR-0009). The `dm_session` cookie holds a random 256-bit secret;
 * `user_sessions.secret_hash` stores only its sha256. Sessions last 30 days and slide:
 * a session seen more than a day after its last refresh gets a fresh 30-day expiry
 * (at most one write per day per session for the slide, one per minute for last_seen_at).
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../contracts/account';
import { getDb, type DbOrTx } from '../db';
import { users, userSessions } from '../db/schema';
import { baseCookieOptions, clearCookie, readRequestCookie, setCookie } from './cookies';
import { generateToken, sha256Hex } from './tokens';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Slide the expiry at most once per this interval. */
export const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;
export const SESSION_SECRET_PREFIX = 'dms';

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof userSessions.$inferSelect;

export type CreatedSession = { sessionId: string; secret: string; expiresAt: Date };

export async function createSession(
    userId: string,
    opts: { deviceHash?: string | null; userAgent?: string | null; now?: Date; db?: DbOrTx } = {},
): Promise<CreatedSession> {
    const now = opts.now ?? new Date();
    const secret = generateToken(SESSION_SECRET_PREFIX);
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const [row] = await (opts.db ?? getDb())
        .insert(userSessions)
        .values({
            userId,
            secretHash: sha256Hex(secret),
            deviceHash: opts.deviceHash ?? null,
            userAgent: opts.userAgent ? opts.userAgent.slice(0, 300) : null,
            createdAt: now,
            expiresAt,
            lastSeenAt: now,
        })
        .returning({ id: userSessions.id });
    return { sessionId: row.id, secret, expiresAt };
}

export type ResolvedSession = { session: SessionRow; user: UserRow; refreshed: boolean };

/** Resolve a session secret to its live session + user (null when unknown / expired / revoked). Slides the expiry. */
export async function resolveSession(secret: string | null | undefined, opts: { now?: Date; db?: DbOrTx } = {}): Promise<ResolvedSession | null> {
    if (!secret || secret.length < 20 || secret.length > 200) return null;
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    const [row] = await db
        .select({ session: userSessions, user: users })
        .from(userSessions)
        .innerJoin(users, eq(users.id, userSessions.userId))
        .where(and(eq(userSessions.secretHash, sha256Hex(secret)), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now)))
        .limit(1);
    if (!row) return null;

    const lastRefresh = row.session.expiresAt.getTime() - SESSION_TTL_MS;
    let refreshed = false;
    const patch: Partial<SessionRow> = {};
    if (now.getTime() - lastRefresh >= SESSION_REFRESH_MS) {
        patch.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
        refreshed = true;
    }
    if (!row.session.lastSeenAt || now.getTime() - row.session.lastSeenAt.getTime() > 60_000) patch.lastSeenAt = now;
    if (Object.keys(patch).length) {
        await db.update(userSessions).set(patch).where(eq(userSessions.id, row.session.id));
        Object.assign(row.session, patch);
    }
    return { session: row.session, user: row.user, refreshed };
}

export async function revokeSession(secret: string | null | undefined, opts: { db?: DbOrTx } = {}): Promise<void> {
    if (!secret) return;
    await (opts.db ?? getDb())
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.secretHash, sha256Hex(secret)), isNull(userSessions.revokedAt)));
}

export function readSessionSecret(request: Request): string | null {
    return readRequestCookie(request, SESSION_COOKIE);
}

export function setSessionCookie(response: NextResponse, secret: string, expiresAt: Date): void {
    setCookie(response, SESSION_COOKIE, secret, baseCookieOptions({ expires: expiresAt }));
}

export function clearSessionCookie(response: NextResponse): void {
    clearCookie(response, SESSION_COOKIE);
}
