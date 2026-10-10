/**
 * Passkeys: options are real (@simplewebauthn/server); the two verify functions are mocked
 * so the server's own rules (one-shot challenges, user binding, counters, user handles,
 * sign-in side effects) are tested without a browser authenticator. The full ceremony with
 * a real (virtual) authenticator runs in tests/e2e/accounts-journey.spec.ts.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeResponse, SESSION_COOKIE, SignInResponse } from '@/contracts/account';
import { authChallenges, builds, passkeys } from '@/server/db/schema';
import { newBuildDisplayId } from '@/server/ids';
import { POST as regOptions } from '@/app/api/auth/passkey/register/options/route';
import { POST as regVerify } from '@/app/api/auth/passkey/register/verify/route';
import { POST as loginOptions } from '@/app/api/auth/passkey/login/options/route';
import { POST as loginVerify } from '@/app/api/auth/passkey/login/verify/route';
import { DELETE as deletePasskeyRoute } from '@/app/api/me/passkeys/[id]/route';
import { GET as meRoute } from '@/app/api/me/route';
import { buildGraphWriteLimiter } from '@/server/build-graph';
import { useTestDb } from '../support/db';
import { newDevice, params, req, setCookieValue, signedInUser } from './helpers';

const mocks = vi.hoisted(() => ({ verifyRegistrationResponse: vi.fn(), verifyAuthenticationResponse: vi.fn() }));
vi.mock('@simplewebauthn/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('@simplewebauthn/server')>()), ...mocks }));

const clientData = (challenge: string) => Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: 'http://localhost:3100' })).toString('base64url');
const b64u = (s: string) => Buffer.from(s).toString('base64url');

describe('passkeys', () => {
    const ctx = useTestDb();
    beforeEach(() => {
        mocks.verifyRegistrationResponse.mockReset();
        mocks.verifyAuthenticationResponse.mockReset();
        buildGraphWriteLimiter.reset();
    });

    async function register(user: Awaited<ReturnType<typeof signedInUser>>, credentialId: string) {
        const opts = await regOptions(req('POST', '/api/auth/passkey/register/options', user), params({}));
        expect(opts.status).toBe(200);
        const options = await opts.json();
        expect(options).toMatchObject({ rp: { id: 'localhost', name: 'DiscoverMake' }, user: { name: user.email }, authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
        expect(Buffer.from(options.user.id, 'base64url').toString()).toBe(user.userId);
        mocks.verifyRegistrationResponse.mockResolvedValueOnce({
            verified: true,
            registrationInfo: { credential: { id: credentialId, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'multiDevice', credentialBackedUp: true },
        });
        const response = { id: credentialId, rawId: credentialId, type: 'public-key', response: { clientDataJSON: clientData(options.challenge), attestationObject: 'x' } };
        return regVerify(req('POST', '/api/auth/passkey/register/verify', user, { response, name: 'Laptop' }), params({}));
    }

    it('registration needs a session, binds the challenge to the user and is one-shot', async () => {
        expect((await regOptions(req('POST', '/api/auth/passkey/register/options', newDevice()), params({}))).status).toBe(401);
        const user = await signedInUser();
        const ok = await register(user, 'cred-alice-1');
        expect(ok.status).toBe(201);
        expect(await ok.json()).toEqual({ ok: true, passkeyId: 'cred-alice-1' });
        expect(mocks.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({ expectedOrigin: 'http://localhost:3100', expectedRPID: 'localhost', requireUserVerification: true }));
        const [row] = await ctx.db.select().from(passkeys).where(eq(passkeys.id, 'cred-alice-1'));
        expect(row).toMatchObject({ userId: user.userId, publicKey: Buffer.from([1, 2, 3]).toString('base64url'), name: 'Laptop', backedUp: true, transports: ['internal'] });

        // Replaying the same response: the challenge is consumed.
        const [used] = await ctx.db.select().from(authChallenges).where(eq(authChallenges.userId, user.userId!));
        const replay = { id: 'cred-alice-2', response: { clientDataJSON: clientData(used.challenge!) } };
        expect((await regVerify(req('POST', '/api/auth/passkey/register/verify', user, { response: replay }), params({}))).status).toBe(400);
        expect(mocks.verifyRegistrationResponse).toHaveBeenCalledTimes(1);

        // Another user cannot redeem Alice's challenge.
        const bob = await signedInUser();
        const opts = await (await regOptions(req('POST', '/api/auth/passkey/register/options', user), params({}))).json();
        expect((await regVerify(req('POST', '/api/auth/passkey/register/verify', bob, { response: { id: 'x', response: { clientDataJSON: clientData(opts.challenge) } } }), params({}))).status).toBe(400);

        // A failed verification stores nothing.
        const opts2 = await (await regOptions(req('POST', '/api/auth/passkey/register/options', user), params({}))).json();
        mocks.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
        expect((await regVerify(req('POST', '/api/auth/passkey/register/verify', user, { response: { id: 'bad', response: { clientDataJSON: clientData(opts2.challenge) } } }), params({}))).status).toBe(400);
        expect(await ctx.db.select().from(passkeys).where(eq(passkeys.id, 'bad'))).toHaveLength(0);

        // Listed on /api/me, and removable only by its owner.
        const me = MeResponse.parse(await (await meRoute(req('GET', '/api/me', user), params({}))).json());
        expect(me.passkeys.map((p) => p.id)).toEqual(['cred-alice-1']);
        expect((await deletePasskeyRoute(req('DELETE', '/api/me/passkeys/cred-alice-1', bob), params({ id: 'cred-alice-1' }))).status).toBe(404);
        expect((await deletePasskeyRoute(req('DELETE', '/api/me/passkeys/cred-alice-1', user), params({ id: 'cred-alice-1' }))).status).toBe(200);
        expect(await ctx.db.select().from(passkeys).where(eq(passkeys.id, 'cred-alice-1'))).toHaveLength(0);
    });

    it('usernameless login: verifies against the stored credential, updates the counter, signs in and claims the device', async () => {
        const user = await signedInUser('pk-login@example.com');
        expect((await register(user, 'cred-login')).status).toBe(201);
        const device = newDevice();
        const [guestBuild] = await ctx.db.insert(builds).values({ displayId: newBuildDisplayId(), name: 'Guest thing', deviceHash: device.deviceHash }).returning();

        const optsRes = await loginOptions(req('POST', '/api/auth/passkey/login/options', device), params({}));
        const opts = await optsRes.json();
        expect(opts).toMatchObject({ rpId: 'localhost', userVerification: 'required', allowCredentials: [] });
        expect(opts.challengeId).toMatch(/^ach_/);

        mocks.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 5, credentialID: 'cred-login' } });
        const response = { id: 'cred-login', rawId: 'cred-login', type: 'public-key', response: { userHandle: b64u(user.userId!), clientDataJSON: 'x', authenticatorData: 'x', signature: 'x' } };
        const res = await loginVerify(req('POST', '/api/auth/passkey/login/verify', device, { challengeId: opts.challengeId, response }), params({}));
        expect(res.status).toBe(200);
        expect(SignInResponse.parse(await res.json())).toMatchObject({ viewer: { id: user.userId }, created: false, claimed: { builds: 1, orders: 0 } });
        expect(setCookieValue(res, SESSION_COOKIE)).toMatch(/^dms_/);
        const call = mocks.verifyAuthenticationResponse.mock.calls[0][0];
        expect(call).toMatchObject({ expectedChallenge: opts.challenge, expectedRPID: 'localhost', requireUserVerification: true, credential: { id: 'cred-login', counter: 0 } });
        expect(Array.from(call.credential.publicKey)).toEqual([1, 2, 3]);
        const [row] = await ctx.db.select().from(passkeys).where(eq(passkeys.id, 'cred-login'));
        expect(row.counter).toBe(5);
        expect(row.lastUsedAt).not.toBeNull();
        expect((await ctx.db.select().from(builds).where(eq(builds.id, guestBuild.id)))[0].ownerUserId).toBe(user.userId);

        // The challenge is single-use.
        mocks.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 6 } });
        expect((await loginVerify(req('POST', '/api/auth/passkey/login/verify', device, { challengeId: opts.challengeId, response }), params({}))).status).toBe(400);
    });

    it('login refuses unknown credentials, mismatched user handles and failed verification', async () => {
        const user = await signedInUser();
        expect((await register(user, 'cred-strict')).status).toBe(201);
        const fresh = async () => (await (await loginOptions(req('POST', '/api/auth/passkey/login/options', null), params({}))).json()).challengeId as string;

        const unknown = await loginVerify(req('POST', '/api/auth/passkey/login/verify', null, { challengeId: await fresh(), response: { id: 'nope', response: {} } }), params({}));
        expect(unknown.status).toBe(401);

        const mismatch = await loginVerify(req('POST', '/api/auth/passkey/login/verify', null, { challengeId: await fresh(), response: { id: 'cred-strict', response: { userHandle: b64u('usr_someone_else') } } }), params({}));
        expect(mismatch.status).toBe(401);

        mocks.verifyAuthenticationResponse.mockRejectedValueOnce(new Error('Unexpected authentication response signature'));
        const bad = await loginVerify(req('POST', '/api/auth/passkey/login/verify', null, { challengeId: await fresh(), response: { id: 'cred-strict', response: {} } }), params({}));
        expect(bad.status).toBe(401);
        expect(mocks.verifyAuthenticationResponse).toHaveBeenCalledTimes(1);

        const expired = await loginVerify(req('POST', '/api/auth/passkey/login/verify', null, { challengeId: 'ach_doesnotexist', response: { id: 'cred-strict' } }), params({}));
        expect(expired.status).toBe(400);
    });
});
