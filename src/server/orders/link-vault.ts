/**
 * Order-link token vault.
 *
 * ADR-0008 stores only HMAC(ORDER_LINK_SECRET, "<orderId>.<token>") on the order,
 * yet the confirmation email (sent after the payment webhook, possibly minutes
 * later and in another process) must contain the same link the buyer saw at
 * checkout. We therefore keep the token ENCRYPTED with AES-256-GCM under a key
 * derived from ORDER_LINK_SECRET (AAD = orderId) in payments.metadata. A database
 * leak alone still cannot produce a working link, and rotating ORDER_LINK_SECRET
 * still revokes everything.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { buildOrderUrl } from '../auth/order-link';
import { requireSecret } from '../env';

const VERSION = 'v1';

function key(): Buffer {
    return createHash('sha256').update(`order-link-vault:${requireSecret('ORDER_LINK_SECRET')}`).digest();
}

export function sealOrderToken(orderId: string, token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(orderId));
    const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/** Returns null when the box is missing, malformed, or was sealed under another secret/order. */
export function openOrderToken(orderId: string, sealed: unknown): string | null {
    if (typeof sealed !== 'string') return null;
    const [v, iv, tag, ct] = sealed.split('.');
    if (v !== VERSION || !iv || !tag || !ct) return null;
    try {
        const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
        decipher.setAAD(Buffer.from(orderId));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

/** payments.metadata key holding the sealed token. */
export const SEALED_TOKEN_KEY = 'orderLinkSealed';

/** Rebuild the signed buyer URL from a payment's metadata, or null. */
export function orderUrlFromPaymentMetadata(orderId: string, metadata: Record<string, unknown> | null | undefined): string | null {
    const token = openOrderToken(orderId, metadata?.[SEALED_TOKEN_KEY]);
    return token ? buildOrderUrl(orderId, token) : null;
}
