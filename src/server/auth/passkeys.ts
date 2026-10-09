/**
 * Passkeys (WebAuthn, @simplewebauthn/server v13), ADR-0009.
 *
 * - Relying party: rpID = APP_URL hostname, origin = APP_URL origin.
 * - Registration needs a signed-in user; credentials are discoverable (residentKey
 *   required) with user verification required, so login is usernameless.
 * - Every challenge is a one-shot `auth_challenges` row (5 minutes), consumed before
 *   verification so a response can never be replayed.
 */
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type AuthenticatorTransportFuture,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db';
import { authChallenges, passkeys, users } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../http';
import { newId } from '../ids';

export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;
export const MAX_PASSKEYS_PER_USER = 20;
const RP_NAME = 'DiscoverMake';

export function relyingParty(): { rpID: string; origin: string } {
    const url = new URL(env().APP_URL);
    return { rpID: url.hostname, origin: url.origin };
}

const b64u = {
    encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url'),
    decode: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
};

/** The challenge a client response was signed over (from clientDataJSON), or null. */
export function challengeFromResponse(response: { response?: { clientDataJSON?: unknown } }): string | null {
    const raw = response?.response?.clientDataJSON;
    if (typeof raw !== 'string' || raw.length > 4096) return null;
    try {
        const data = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { challenge?: unknown };
        return typeof data.challenge === 'string' ? data.challenge : null;
    } catch {
        return null;
    }
}

function defaultPasskeyName(userAgent: string | null | undefined): string {
    const ua = userAgent ?? '';
    const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'This device';
    return `Passkey on ${os}`;
}

// ---------------------------------------------------------------------------
// Registration (signed in)
// ---------------------------------------------------------------------------

export async function passkeyRegistrationOptions(userId: string, opts: { db?: DbOrTx; now?: Date } = {}): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new ApiError('UNAUTHORIZED', 'Sign in to continue.', 401);
    const existing = await db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, userId));
    if (existing.length >= MAX_PASSKEYS_PER_USER) throw new ApiError('CONFLICT', `You can keep up to ${MAX_PASSKEYS_PER_USER} passkeys. Remove one first.`);
    const { rpID } = relyingParty();
    const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID,
        userName: user.email,
        userDisplayName: user.displayName ?? user.email,
        userID: new TextEncoder().encode(user.id),
        attestationType: 'none',
        excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransportFuture[] })),
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    });
    await db.insert(authChallenges).values({ kind: 'passkey_register', userId, challenge: options.challenge, expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS), createdAt: now });
    return options;
}

export async function verifyPasskeyRegistration(
    userId: string,
    response: Record<string, unknown>,
    opts: { name?: string; userAgent?: string | null; db?: DbOrTx; now?: Date } = {},
): Promise<{ passkeyId: string }> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    const challenge = challengeFromResponse(response as { response?: { clientDataJSON?: unknown } });
    if (!challenge) throw new ApiError('BAD_REQUEST', 'The passkey response is not valid.', 400);
    const [row] = await db
        .update(authChallenges)
        .set({ consumedAt: now })
        .where(
            and(
                eq(authChallenges.kind, 'passkey_register'),
                eq(authChallenges.userId, userId),
                eq(authChallenges.challenge, challenge),
                isNull(authChallenges.consumedAt),
                gt(authChallenges.expiresAt, now),
            ),
        )
        .returning();
    if (!row) throw new ApiError('BAD_REQUEST', 'This passkey request expired. Try again.', 400);

    const { rpID, origin } = relyingParty();
    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response: response as unknown as RegistrationResponseJSON,
            expectedChallenge: row.challenge!,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: true,
        });
    } catch (err) {
        throw new ApiError('BAD_REQUEST', `The passkey could not be verified: ${(err as Error).message}`.slice(0, 300), 400);
    }
    if (!verification.verified) throw new ApiError('BAD_REQUEST', 'The passkey could not be verified.', 400);
    const info = verification.registrationInfo;
    const [taken] = await db.select({ userId: passkeys.userId }).from(passkeys).where(eq(passkeys.id, info.credential.id));
    if (taken) throw new ApiError('CONFLICT', 'This passkey is already registered.');
    await db.insert(passkeys).values({
        id: info.credential.id,
        userId,
        publicKey: b64u.encode(info.credential.publicKey),
        counter: info.credential.counter,
        transports: (info.credential.transports ?? []) as string[],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name: (opts.name?.trim() || defaultPasskeyName(opts.userAgent)).slice(0, 60),
        createdAt: now,
    });
    return { passkeyId: info.credential.id };
}

// ---------------------------------------------------------------------------
// Login (usernameless)
// ---------------------------------------------------------------------------

export async function passkeyLoginOptions(opts: { db?: DbOrTx; now?: Date } = {}): Promise<PublicKeyCredentialRequestOptionsJSON & { challengeId: string }> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    const { rpID } = relyingParty();
    const options = await generateAuthenticationOptions({ rpID, allowCredentials: [], userVerification: 'required' });
    const challengeId = newId('authChallenge');
    await db.insert(authChallenges).values({ id: challengeId, kind: 'passkey_login', challenge: options.challenge, expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS), createdAt: now });
    return { ...options, challengeId };
}

/** Verify a login assertion; returns the user id it proves. */
export async function verifyPasskeyLogin(challengeId: string, response: Record<string, unknown>, opts: { db?: DbOrTx; now?: Date } = {}): Promise<{ userId: string; passkeyId: string }> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    const [row] = await db
        .update(authChallenges)
        .set({ consumedAt: now })
        .where(and(eq(authChallenges.id, challengeId), eq(authChallenges.kind, 'passkey_login'), isNull(authChallenges.consumedAt), gt(authChallenges.expiresAt, now)))
        .returning();
    if (!row?.challenge) throw new ApiError('BAD_REQUEST', 'This sign-in request expired. Try again.', 400);

    const credentialId = typeof response.id === 'string' ? response.id : null;
    const [passkey] = credentialId ? await db.select().from(passkeys).where(eq(passkeys.id, credentialId)) : [];
    if (!passkey) throw new ApiError('UNAUTHORIZED', 'We do not recognise this passkey. Sign in with your email, then add it again.', 401);

    // Discoverable credentials return the user handle we registered (the user id bytes).
    const handle = (response.response as { userHandle?: unknown } | undefined)?.userHandle;
    if (typeof handle === 'string' && handle && Buffer.from(handle, 'base64url').toString('utf8') !== passkey.userId) {
        throw new ApiError('UNAUTHORIZED', 'This passkey does not match its account.', 401);
    }

    const { rpID, origin } = relyingParty();
    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response: response as unknown as AuthenticationResponseJSON,
            expectedChallenge: row.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: { id: passkey.id, publicKey: b64u.decode(passkey.publicKey), counter: passkey.counter, transports: passkey.transports as AuthenticatorTransportFuture[] },
            requireUserVerification: true,
        });
    } catch (err) {
        throw new ApiError('UNAUTHORIZED', `The passkey could not be verified: ${(err as Error).message}`.slice(0, 300), 401);
    }
    if (!verification.verified) throw new ApiError('UNAUTHORIZED', 'The passkey could not be verified.', 401);
    await db.update(passkeys).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: now }).where(eq(passkeys.id, passkey.id));
    return { userId: passkey.userId, passkeyId: passkey.id };
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

export async function listPasskeys(userId: string, db: DbOrTx = getDb()) {
    const rows = await db.select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(desc(passkeys.createdAt));
    return rows.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null }));
}

export async function deletePasskey(userId: string, passkeyId: string, db: DbOrTx = getDb()): Promise<void> {
    const rows = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
    if (!rows.length) throw new ApiError('NOT_FOUND', 'Passkey not found');
}
