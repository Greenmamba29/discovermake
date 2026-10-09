/**
 * Live Build Protocol signatures (workflow 06 rule 2: only the server issues
 * commerce-affecting events).
 *
 *   sig = "v1." + HMAC-SHA256(LIVE_EVENT_SIGNING_SECRET, canonicalJson(event without sig)) as hex
 *
 * `canonicalJson` sorts keys recursively and drops `undefined`, so the signature survives a
 * jsonb round trip. Events in SIGNED_LIVE_EVENTS must carry a valid `sig`; others must not
 * be trusted for commerce state (clients only render them).
 */
import type { z } from 'zod';
import { isSignedLiveEvent, type LiveEventBase, type LiveEventType } from '../../contracts/live';
import { canonicalJson, hmacHex, safeEqual } from '../auth/tokens';
import { requireSecret } from '../env';

/** Any event shape (signed or not), as read off the wire before checking. */
export type AnyLiveEvent = z.infer<typeof LiveEventBase>;

export const LIVE_SIG_PREFIX = 'v1.';

export type UnsignedLiveEvent = Omit<AnyLiveEvent, 'sig'>;

/** LIVE_EVENT_SIGNING_SECRET; throws in production when unset, dev fallback elsewhere. */
export function liveSigningSecret(): string {
    return requireSecret('LIVE_EVENT_SIGNING_SECRET');
}

export function isSignedEventType(type: LiveEventType): boolean {
    return isSignedLiveEvent(type);
}

function unsigned(event: AnyLiveEvent | UnsignedLiveEvent): UnsignedLiveEvent {
    const { sig: _sig, ...rest } = event as AnyLiveEvent;
    void _sig;
    return rest;
}

export function signLiveEvent(event: UnsignedLiveEvent | AnyLiveEvent, secret: string = liveSigningSecret()): string {
    return LIVE_SIG_PREFIX + hmacHex(secret, canonicalJson(unsigned(event)));
}

/**
 * True when the event's signature is valid. Signed event types without a `sig` (or with a
 * tampered body) fail; unsigned event types pass only when they carry no `sig` or a valid one.
 */
export function verifyLiveEvent(event: AnyLiveEvent, secret: string = liveSigningSecret()): boolean {
    if (!event.sig) return !isSignedEventType(event.event);
    if (!event.sig.startsWith(LIVE_SIG_PREFIX)) return false;
    return safeEqual(event.sig, signLiveEvent(event, secret));
}
