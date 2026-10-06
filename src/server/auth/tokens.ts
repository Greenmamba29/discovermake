/**
 * Token + signing primitives shared by every auth mechanism in R1 (ADR-0008).
 * Fully implemented foundation; do not fork these per module.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random secret, e.g. `generateToken('dmshop')` -> `dmshop_<43 chars>` (256 bits). */
export function generateToken(prefix?: string, bytes = 32): string {
    const raw = randomBytes(bytes).toString('base64url');
    return prefix ? `${prefix}_${raw}` : raw;
}

/** sha256 hex of a token (shop console tokens, shop session secrets). */
export function sha256Hex(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

/** HMAC-SHA256 hex. */
export function hmacHex(secret: string, value: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
}

/** Constant-time string comparison (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

/**
 * Deterministic JSON for hashing/signing: object keys sorted recursively,
 * `undefined` dropped, no whitespace.
 */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const v = (value as Record<string, unknown>)[key];
            if (v !== undefined) out[key] = sortDeep(v);
        }
        return out;
    }
    if (value instanceof Date) return value.toISOString();
    return value;
}

/** Extract a bearer token from an Authorization header. */
export function bearerToken(headers: Headers): string | null {
    const h = headers.get('authorization');
    if (!h) return null;
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    return m ? m[1].trim() : null;
}
