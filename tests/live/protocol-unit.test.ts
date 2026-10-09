/**
 * Pure Live Build Protocol pieces: signatures, moderation, slow mode, mutes.
 */
import { describe, expect, it } from 'vitest';
import { LiveEvent } from '@/contracts/live';
import type { AnyLiveEvent } from '@/server/live/signing';
import { checkSlowMode, containsBlockedTerm, containsLink, isMuted, moderateText, normalizeForFilter } from '@/server/live/moderation';
import { isSignedEventType, LIVE_SIG_PREFIX, signLiveEvent, verifyLiveEvent } from '@/server/live/signing';

const SECRET = 'test-live-secret';

function focusEvent(): AnyLiveEvent {
    return {
        v: 1,
        event: 'product.focus',
        showId: 'shw_test1',
        seq: 7,
        streamTsMs: 1834000,
        actor: { kind: 'host', id: 'usr_host1', name: 'Amanda' },
        buildId: 'bld_test1',
        designVersion: 3,
        payload: { priceCents: 16800, leadTimeDays: 6, makeability: 94, nested: { b: 2, a: 1 } },
        at: '2026-10-09T12:00:00.000Z',
    };
}

describe('signLiveEvent / verifyLiveEvent', () => {
    it('signs commerce events and verifies them, independent of key order', () => {
        const e = focusEvent();
        const sig = signLiveEvent(e, SECRET);
        expect(sig.startsWith(LIVE_SIG_PREFIX)).toBe(true);
        const signed = { ...e, sig };
        expect(verifyLiveEvent(signed, SECRET)).toBe(true);
        // Same content, different key order (what a jsonb round trip may do).
        const reordered = JSON.parse(JSON.stringify({ sig, at: e.at, payload: { nested: { a: 1, b: 2 }, makeability: 94, leadTimeDays: 6, priceCents: 16800 }, designVersion: 3, buildId: e.buildId, actor: e.actor, streamTsMs: e.streamTsMs, seq: e.seq, showId: e.showId, event: e.event, v: 1 }));
        expect(verifyLiveEvent(reordered, SECRET)).toBe(true);
        expect(LiveEvent.safeParse(signed).success).toBe(true);
    });

    it('detects tampering with the payload, the seq, the actor or the secret', () => {
        const e = focusEvent();
        const signed = { ...e, sig: signLiveEvent(e, SECRET) };
        expect(verifyLiveEvent({ ...signed, payload: { ...signed.payload, priceCents: 100 } }, SECRET)).toBe(false);
        expect(verifyLiveEvent({ ...signed, seq: 8 }, SECRET)).toBe(false);
        expect(verifyLiveEvent({ ...signed, actor: { ...signed.actor, kind: 'viewer' } }, SECRET)).toBe(false);
        expect(verifyLiveEvent(signed, 'another-secret')).toBe(false);
        expect(verifyLiveEvent({ ...signed, sig: 'v1.deadbeef' }, SECRET)).toBe(false);
    });

    it('signed event types without a sig never verify (and the contract rejects them)', () => {
        const e = focusEvent();
        expect(isSignedEventType('product.focus')).toBe(true);
        expect(verifyLiveEvent(e, SECRET)).toBe(false);
        expect(LiveEvent.safeParse(e).success).toBe(false);
        const chat: AnyLiveEvent = { ...e, event: 'chat.message', payload: { text: 'hi' } };
        expect(isSignedEventType('chat.message')).toBe(false);
        expect(verifyLiveEvent(chat, SECRET)).toBe(true);
    });
});

describe('moderation', () => {
    it('blocks listed terms, including look-alike spellings and spaced letters', () => {
        expect(moderateText('this lamp is sh1t').ok).toBe(false);
        expect(moderateText('f.u.c.k this').ok).toBe(false);
        expect(moderateText('FUCKING great').ok).toBe(false);
        expect(containsBlockedTerm('kill yourself')).toBe(true);
        expect(normalizeForFilter('S h 1 t')).toContain('shit');
    });

    it('allows ordinary maker chat (no substring false positives)', () => {
        for (const ok of ['Can it be 30% larger?', 'Class act, love the walnut', 'Is 6061 better than 5052?', 'Assemble with M4 screws', 'Scunthorpe shipping?']) {
            expect(moderateText(ok)).toEqual({ ok: true, text: ok });
        }
    });

    it('blocks links and bare domains', () => {
        expect(containsLink('see https://example.com')).toBe(true);
        expect(containsLink('www.example.org')).toBe(true);
        expect(containsLink('cheap parts at mystore.shop')).toBe(true);
        expect(containsLink('dm me on t.me now')).toBe(true);
        expect(moderateText('buy here: bit.ly/x')).toMatchObject({ ok: false, reason: 'link' });
        expect(containsLink('it is 0.5 mm thick, e.g. for a lid')).toBe(false);
    });

    it('rejects empty text after trimming', () => {
        expect(moderateText('   ')).toMatchObject({ ok: false, reason: 'empty' });
    });

    it('slow mode allows one message per window', () => {
        const now = new Date('2026-10-09T12:00:30Z');
        expect(checkSlowMode(null, 30, now)).toEqual({ ok: true });
        expect(checkSlowMode(new Date('2026-10-09T12:00:00Z'), 0, now)).toEqual({ ok: true });
        expect(checkSlowMode(new Date('2026-10-09T12:00:10Z'), 30, now)).toEqual({ ok: false, retryAfterSeconds: 10 });
        expect(checkSlowMode(new Date('2026-10-09T12:00:00Z'), 30, now)).toEqual({ ok: true });
    });

    it('mutes expire', () => {
        const now = new Date('2026-10-09T12:00:00Z');
        expect(isMuted(new Date('2026-10-09T12:05:00Z'), now)).toBe(true);
        expect(isMuted(new Date('2026-10-09T11:59:00Z'), now)).toBe(false);
        expect(isMuted(null, now)).toBe(false);
    });
});
