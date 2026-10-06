/**
 * Id generation. Ids are `<prefix>_<20 chars Crockford base32>` (100 bits of
 * randomness): unguessable, URL-safe, sortable enough for humans to read.
 * Event ids are UUIDv7 (ADR-0002).
 */
import { randomBytes } from 'node:crypto';
import { ID_PREFIX, type IdKind } from '../contracts/common';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32(bytes: Uint8Array, length: number): string {
    let out = '';
    let bits = 0;
    let value = 0;
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5 && out.length < length) {
            out += CROCKFORD[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    return out;
}

/** Random Crockford base32 string of `length` characters. */
export function randomBase32(length: number): string {
    return base32(randomBytes(Math.ceil((length * 5) / 8) + 1), length);
}

/** New prefixed id, e.g. `newId('part')` -> `prt_7Q2M...`. Lowercased for readability in URLs. */
export function newId(kind: IdKind): string {
    return `${ID_PREFIX[kind]}_${randomBase32(20).toLowerCase()}`;
}

/** Human display id for builds: `DM-` + 5 Crockford chars. Not unique by construction; the DB enforces uniqueness. */
export function newBuildDisplayId(): string {
    return `DM-${randomBase32(5)}`;
}

/** Human order number: `DMO-` + 6 Crockford chars. DB enforces uniqueness. */
export function newOrderNumber(): string {
    return `DMO-${randomBase32(6)}`;
}

/** RFC 9562 UUIDv7 (time-ordered). */
export function uuidv7(now: number = Date.now()): string {
    const bytes = randomBytes(16);
    const ts = BigInt(now);
    bytes[0] = Number((ts >> BigInt(40)) & BigInt(0xff));
    bytes[1] = Number((ts >> BigInt(32)) & BigInt(0xff));
    bytes[2] = Number((ts >> BigInt(24)) & BigInt(0xff));
    bytes[3] = Number((ts >> BigInt(16)) & BigInt(0xff));
    bytes[4] = Number((ts >> BigInt(8)) & BigInt(0xff));
    bytes[5] = Number(ts & BigInt(0xff));
    bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
