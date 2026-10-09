/**
 * Email sign-in codes (ADR-0009).
 *
 * - 6 random digits, valid 10 minutes, one use, at most 5 wrong tries per code.
 * - Stored only as HMAC-SHA256(AUTH_SECRET, "<challengeId>.<code>").
 * - Rate limits: 5 codes per email per hour (durable, counted in auth_challenges) and
 *   10 codes per IP per 10 minutes (in-memory per instance, like the other R2 limits).
 * - Delivered through the notify module (Resend). Outside production with no
 *   RESEND_API_KEY the code is also returned as `devCode` so local dev and e2e work.
 */
import { randomInt } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { EmailStartResponse } from '../../contracts/account';
import { getDb, type DbOrTx } from '../db';
import { authChallenges } from '../db/schema';
import { env, isProduction, requireSecret } from '../env';
import { ApiError } from '../http';
import { newId } from '../ids';
import { FixedWindowRateLimiter } from '../make-ai/rate-limit';
import { notify } from '../notify';
import { hmacHex, safeEqual } from './tokens';
import { normalizeEmail } from './users';

export const EMAIL_CODE_TTL_MINUTES = 10;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODES_PER_EMAIL_PER_HOUR = 5;
export const EMAIL_CODE_IP_LIMIT = { limit: 10, windowMs: 10 * 60_000 } as const;

export const emailStartIpLimiter = new FixedWindowRateLimiter(EMAIL_CODE_IP_LIMIT.limit, EMAIL_CODE_IP_LIMIT.windowMs);
/** Verify attempts per IP (across challenges), so one client cannot spray guesses. */
export const emailVerifyIpLimiter = new FixedWindowRateLimiter(30, 10 * 60_000);

export function hashEmailCode(challengeId: string, code: string): string {
    return hmacHex(requireSecret('AUTH_SECRET'), `${challengeId}.${code}`);
}

export function generateEmailCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function rateLimited(message: string, retryAfterSeconds?: number): ApiError {
    return new ApiError('RATE_LIMITED', message, 429, retryAfterSeconds ? { retryAfterSeconds } : undefined);
}

export async function startEmailSignIn(
    rawEmail: string,
    opts: { ip?: string; now?: Date; db?: DbOrTx; code?: string } = {},
): Promise<EmailStartResponse> {
    const email = normalizeEmail(rawEmail);
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    const apiKey = env().RESEND_API_KEY;
    if (isProduction() && !apiKey) throw new ApiError('INTERNAL', 'Email sign-in is not available right now. Try a passkey.', 503);

    if (opts.ip) {
        const d = emailStartIpLimiter.hit(opts.ip, now.getTime());
        if (!d.allowed) throw rateLimited('Too many codes requested from this network. Wait a few minutes and try again.', d.retryAfterSeconds);
    }
    const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authChallenges)
        .where(and(eq(authChallenges.kind, 'email'), eq(authChallenges.email, email), gt(authChallenges.createdAt, new Date(now.getTime() - 60 * 60_000))));
    if (count >= EMAIL_CODES_PER_EMAIL_PER_HOUR) throw rateLimited('Too many codes for this email. Wait an hour, or use the latest code we sent.');

    const challengeId = newId('authChallenge');
    const code = opts.code ?? generateEmailCode();
    const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MINUTES * 60_000);
    await db.insert(authChallenges).values({ id: challengeId, kind: 'email', email, codeHash: hashEmailCode(challengeId, code), expiresAt, createdAt: now });

    const sent = await notify('auth.sign_in_code', { to: email, code, challengeId, expiresMinutes: EMAIL_CODE_TTL_MINUTES });
    if (apiKey && !sent.delivered) throw new ApiError('INTERNAL', 'We could not send the code. Try again in a moment.', 502);

    return { challengeId, expiresAt: expiresAt.toISOString(), ...(!isProduction() && !apiKey ? { devCode: code } : {}) };
}

export type VerifiedEmail = { email: string; challengeId: string };

/**
 * Check a code. Every attempt is counted atomically before comparing, so concurrent
 * guesses cannot exceed the cap. A correct code consumes the challenge.
 */
export async function verifyEmailCode(challengeId: string, code: string, opts: { ip?: string; now?: Date; db?: DbOrTx } = {}): Promise<VerifiedEmail> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? new Date();
    if (opts.ip) {
        const d = emailVerifyIpLimiter.hit(opts.ip, now.getTime());
        if (!d.allowed) throw rateLimited('Too many attempts. Wait a few minutes and try again.', d.retryAfterSeconds);
    }
    const [row] = await db.select().from(authChallenges).where(and(eq(authChallenges.id, challengeId), eq(authChallenges.kind, 'email')));
    if (!row || !row.email || !row.codeHash) throw new ApiError('BAD_REQUEST', 'That code has expired. Ask for a new one.', 400, { reason: 'expired' });
    if (row.consumedAt) throw new ApiError('BAD_REQUEST', 'That code was already used. Ask for a new one.', 400, { reason: 'used' });
    if (row.expiresAt.getTime() <= now.getTime()) throw new ApiError('BAD_REQUEST', 'That code has expired. Ask for a new one.', 400, { reason: 'expired' });

    const [counted] = await db
        .update(authChallenges)
        .set({ attempts: sql`${authChallenges.attempts} + 1` })
        .where(and(eq(authChallenges.id, challengeId), isNull(authChallenges.consumedAt), lt(authChallenges.attempts, EMAIL_CODE_MAX_ATTEMPTS)))
        .returning({ attempts: authChallenges.attempts });
    if (!counted) throw rateLimited('Too many wrong codes. Ask for a new one.');

    if (!safeEqual(hashEmailCode(challengeId, code), row.codeHash)) {
        const left = EMAIL_CODE_MAX_ATTEMPTS - counted.attempts;
        if (left <= 0) throw rateLimited('Too many wrong codes. Ask for a new one.');
        throw new ApiError('BAD_REQUEST', `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 400, { reason: 'wrong_code', attemptsLeft: left });
    }
    const [consumed] = await db
        .update(authChallenges)
        .set({ consumedAt: now })
        .where(and(eq(authChallenges.id, challengeId), isNull(authChallenges.consumedAt)))
        .returning({ id: authChallenges.id });
    if (!consumed) throw new ApiError('BAD_REQUEST', 'That code was already used. Ask for a new one.', 400, { reason: 'used' });
    return { email: row.email, challengeId };
}
