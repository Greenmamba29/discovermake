/**
 * Sign-in entry points shared by the route handlers (ADR-0009). Each verifies its proof,
 * then hands off to `completeSignIn` (roles, claims, preferences, session, events).
 */
import { and, eq } from 'drizzle-orm';
import type { NextResponse } from 'next/server';
import type { SignInResponse } from '../../contracts/account';
import { getDb, type DbOrTx } from '../db';
import { oauthAccounts, users } from '../db/schema';
import { json } from '../http';
import { getDeviceHash, resolveDevice, applyDevice } from './device';
import type { OidcIdentity } from './oidc';
import { setSessionCookie } from './sessions';
import { completeSignIn, normalizeEmail, type SignInResult } from './users';

export function requestMeta(request: Request): { deviceHash: string | null; userAgent: string | null } {
    return { deviceHash: getDeviceHash(request), userAgent: request.headers.get('user-agent') };
}

/** JSON SignInResponse with dm_session set (and dm_device, when the browser had none). */
export function signInJson(request: Request, result: SignInResult): NextResponse<SignInResponse> {
    const res = json<SignInResponse>({ viewer: result.viewer, created: result.created, claimed: result.claimed });
    setSessionCookie(res, result.session.secret, result.session.expiresAt);
    return res;
}

/**
 * Device for a sign-in: the browser's existing device (so its guest builds are claimed)
 * or a new one that the session is bound to.
 */
export function signInDevice(request: Request): { hash: string; apply: (res: NextResponse) => void } {
    const device = resolveDevice(request);
    return { hash: device.hash, apply: (res) => applyDevice(res, device) };
}

/** OIDC: an existing provider link wins; else the verified email's account (created if new) is linked. */
export async function signInWithOidc(identity: OidcIdentity, meta: { deviceHash: string | null; userAgent: string | null }, db: DbOrTx = getDb()): Promise<SignInResult> {
    const [link] = await db
        .select({ userId: oauthAccounts.userId })
        .from(oauthAccounts)
        .where(and(eq(oauthAccounts.provider, identity.provider), eq(oauthAccounts.providerUserId, identity.subject)));
    return completeSignIn(
        {
            method: identity.provider,
            ...(link ? { userId: link.userId } : { email: normalizeEmail(identity.email) }),
            deviceHash: meta.deviceHash,
            userAgent: meta.userAgent,
            onUser: async (tx, user) => {
                if (!link) await tx.insert(oauthAccounts).values({ provider: identity.provider, providerUserId: identity.subject, userId: user.id }).onConflictDoNothing();
                if (!user.displayName && identity.name) await tx.update(users).set({ displayName: identity.name }).where(eq(users.id, user.id));
            },
        },
        db,
    );
}
