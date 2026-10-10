/** Kids mode cookie signing and the grown-up PIN hash. */
import { describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { signKidCookie, verifyKidCookie } from '@/server/kids/cookie';
import { hashPin, verifyPin } from '@/server/kids/pin';

const claims = { k: 'kid_abc', o: 'usr_parent', s: 'uss_session' };

describe('kid session cookie', () => {
    it('round-trips signed claims', () => {
        const v = signKidCookie(claims);
        expect(v).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        expect(verifyKidCookie(v)).toMatchObject(claims);
    });

    it('rejects tampering: payload, signature, version, garbage', () => {
        const v = signKidCookie(claims);
        const [ver, payload, sig] = v.split('.');
        const forged = Buffer.from(JSON.stringify({ ...claims, k: 'kid_other', iat: 1 })).toString('base64url');
        expect(verifyKidCookie(`${ver}.${forged}.${sig}`)).toBeNull();
        expect(verifyKidCookie(`${ver}.${payload}.${sig!.slice(0, -2)}xx`)).toBeNull();
        expect(verifyKidCookie(`v2.${payload}.${sig}`)).toBeNull();
        expect(verifyKidCookie('')).toBeNull();
        expect(verifyKidCookie(null)).toBeNull();
        expect(verifyKidCookie('not-a-cookie')).toBeNull();
        expect(verifyKidCookie(`${v}.extra`)).toBeNull();
    });

    it('a cookie signed with another AUTH_SECRET is rejected', () => {
        const v = signKidCookie(claims);
        process.env.AUTH_SECRET = 'a-different-secret-for-this-test';
        resetEnvCache();
        try {
            expect(verifyKidCookie(v)).toBeNull();
            expect(verifyKidCookie(signKidCookie(claims))).toMatchObject(claims);
        } finally {
            delete process.env.AUTH_SECRET;
            resetEnvCache();
        }
    });
});

describe('grown-up PIN hash', () => {
    it('hashes with a per-PIN salt and verifies only the right PIN', async () => {
        const a = await hashPin('2468');
        const b = await hashPin('2468');
        expect(a).toMatch(/^scrypt1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
        expect(a).not.toBe(b);
        expect(a).not.toContain('2468');
        expect(await verifyPin('2468', a)).toBe(true);
        expect(await verifyPin('2469', a)).toBe(false);
        expect(await verifyPin('246', a)).toBe(false);
        expect(await verifyPin('2468', null)).toBe(false);
        expect(await verifyPin('2468', 'plain$2468')).toBe(false);
    });

    it('is peppered with AUTH_SECRET: the hash alone does not verify under another server secret', async () => {
        const h = await hashPin('1357');
        process.env.AUTH_SECRET = 'rotated-secret';
        resetEnvCache();
        try {
            expect(await verifyPin('1357', h)).toBe(false);
        } finally {
            delete process.env.AUTH_SECRET;
            resetEnvCache();
        }
        expect(await verifyPin('1357', h)).toBe(true);
    });

    it('refuses to hash anything but 4 digits', async () => {
        await expect(hashPin('12345')).rejects.toThrow();
    });
});
