/**
 * Grown-up PIN (4 digits). Stored as `scrypt1$<salt>$<hash>`: scrypt (N=2^15, r=8, p=1) over
 * HMAC-SHA256(AUTH_SECRET-derived key, pin), with a 16-byte random salt per PIN. A database leak
 * alone cannot brute-force the 10 000 PINs without the server secret, and each guess is slow.
 * Attempts are rate limited per grown-up through the shared limiter (src/server/rate-limit).
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { GrownUpPin } from '@/contracts/kids';
import { requireSecret } from '../env';
import { RateLimiter } from '../rate-limit';

const SCRYPT: ScryptOptions = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;
const PREFIX = 'scrypt1';

/** 5 wrong-or-right attempts per grown-up per 15 minutes (exit Kids mode). */
export const PIN_ATTEMPT_LIMIT = { limit: 5, windowMs: 15 * 60_000 } as const;
export const pinAttemptLimiter = new RateLimiter('kids_pin_attempt', { kind: 'fixed_window', ...PIN_ATTEMPT_LIMIT });

function scrypt(input: Buffer, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => scryptCb(input, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

function pepper(pin: string): Buffer {
    const key = createHmac('sha256', requireSecret('AUTH_SECRET')).update('dm_kids_pin.v1').digest();
    return createHmac('sha256', key).update(pin).digest();
}

export async function hashPin(pin: string): Promise<string> {
    const checked = GrownUpPin.parse(pin);
    const salt = randomBytes(16);
    const hash = await scrypt(pepper(checked), salt);
    return `${PREFIX}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
    if (!stored || !GrownUpPin.safeParse(pin).success) return false;
    const [prefix, saltB64, hashB64] = stored.split('$');
    if (prefix !== PREFIX || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = await scrypt(pepper(pin), Buffer.from(saltB64, 'base64url'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
