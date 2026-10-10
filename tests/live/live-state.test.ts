/**
 * Client reducer for the live overlay: the NOW SHOWING card and slot counter follow events
 * only, re-applied events are no-ops, unsigned commerce events are rejected, replays fold
 * the log up to the player position.
 */
import { describe, expect, it } from 'vitest';
import type { FeaturedProduct, LiveEvent, ShowSnapshot } from '@/contracts/live';
import { applyEvent, parseLiveEvent, replayAt, replayBase, stateFromSnapshot, visibleChat } from '@/components/live/live-state';

const AT = '2026-10-09T12:00:00.000Z';

const product = (buildId: string, name: string): FeaturedProduct => ({
    buildId,
    designVersion: 1,
    name,
    priceCents: 16800,
    leadTimeDays: 6,
    materialLabel: '5052 Aluminum',
    makeability: 94,
    canMakeThis: true,
    canRemix: false,
    canBuy: true,
    quoteId: 'qte_test1',
    displayId: 'DM-ABCDE',
    partId: 'prt_test1',
    specLine: '5052 Aluminum · 0.063"',
    hasApprovedVersion: false,
});

function snapshot(): ShowSnapshot {
    return {
        show: {
            id: 'shw_test1',
            displayId: 'LIVE-101',
            channel: { id: 'chn_test1', handle: 'amanda', name: 'Amanda', kind: 'creator', categories: [], bio: null, ownerUserId: null, followerCount: 0, viewerFollows: false, createdAt: AT },
            title: 'Lamp night',
            format: 'live_drop',
            status: 'LIVE',
            scheduledFor: AT,
            startedAt: AT,
            endedAt: null,
            source: { kind: 'none' },
            viewerCount: 3,
            likeCount: 0,
            thumbnailUrl: null,
        },
        featured: null,
        drop: null,
        questions: [],
        recentChat: [],
        lastSeq: 2,
        viewerRole: 'viewer',
        poll: null,
        slowModeSeconds: 0,
        viewerMutedUntil: null,
        viewerLiked: false,
        viewerClaims: [],
        replayEvents: null,
    };
}

function ev(seq: number, event: LiveEvent['event'], payload: Record<string, unknown>, extra: Partial<LiveEvent> = {}): LiveEvent {
    return { v: 1, event, showId: 'shw_test1', seq, streamTsMs: seq * 1000, actor: { kind: 'host', id: 'usr_h1', name: 'Amanda' }, payload, at: AT, sig: 'v1.test', ...extra } as LiveEvent;
}

describe('live overlay state', () => {
    it('switches the product card on product.focus and ignores replays of older seqs', () => {
        let s = stateFromSnapshot(snapshot());
        s = applyEvent(s, ev(3, 'product.focus', product('bld_a1', 'Lamp A')));
        expect(s.featured?.name).toBe('Lamp A');
        s = applyEvent(s, ev(4, 'product.focus', product('bld_b1', 'Lamp B')));
        expect(s.featured?.buildId).toBe('bld_b1');
        const again = applyEvent(s, ev(3, 'product.focus', product('bld_a1', 'Lamp A')));
        expect(again).toBe(s);
    });

    it('tracks the drop counter from absolute counts and the final status', () => {
        let s = stateFromSnapshot(snapshot());
        const drop = { id: 'drp_1', showId: 'shw_test1', buildId: 'bld_a1', title: 'Lamp', priceCents: 18400, totalSlots: 250, claimedSlots: 0, thresholdSlots: 200, perBuyerLimit: 2, status: 'OPEN', opensAt: AT, closesAt: AT, viewerClaimedSlots: 0 };
        s = applyEvent(s, ev(3, 'drop.started', { drop }));
        s = applyEvent(s, ev(4, 'build_slot.claimed', { dropId: 'drp_1', claimedSlots: 182 }));
        expect(s.drop?.claimedSlots).toBe(182);
        s = applyEvent(s, ev(5, 'inventory.change', { dropId: 'drp_1', claimedSlots: 181 }));
        s = applyEvent(s, ev(6, 'drop.closed', { dropId: 'drp_1', status: 'FAILED', claimedSlots: 181 }));
        expect(s.drop).toMatchObject({ status: 'FAILED', claimedSlots: 181 });
    });

    it('hides removed chat lines and keeps questions in sync', () => {
        let s = stateFromSnapshot(snapshot());
        s = applyEvent(s, ev(3, 'chat.message', { text: 'hello' }, { sig: undefined }));
        s = applyEvent(s, ev(4, 'chat.message', { text: 'spam' }, { sig: undefined }));
        s = applyEvent(s, ev(5, 'chat.removed', { eventSeq: 4 }, { sig: undefined }));
        expect(visibleChat(s).map((c) => c.payload.text)).toEqual(['hello']);
        s = applyEvent(s, ev(6, 'question.created', { questionId: 'lvq_1', mode: 'creator', text: 'Black?', askedBy: 'Vic' }, { sig: undefined }));
        s = applyEvent(s, ev(7, 'question.answered', { questionId: 'lvq_1', answer: 'Yes', answeredBy: 'host' }, { sig: undefined }));
        expect(s.questions[0]).toMatchObject({ id: 'lvq_1', answer: 'Yes', answeredBy: 'host' });
    });

    it('rejects commerce events without a signature', () => {
        const unsigned = { ...ev(3, 'product.focus', product('bld_a1', 'Lamp A')), sig: undefined };
        expect(parseLiveEvent(unsigned)).toBeNull();
        expect(parseLiveEvent(ev(3, 'product.focus', product('bld_a1', 'Lamp A')))).not.toBeNull();
    });

    it('replays fold the log up to the player position', () => {
        const snap = { ...snapshot(), show: { ...snapshot().show, status: 'ENDED' as const } };
        const log = [ev(1, 'product.focus', product('bld_a1', 'Lamp A')), ev(5, 'product.focus', product('bld_b1', 'Lamp B'))];
        const base = replayBase(snap);
        expect(replayAt(base, log, 500).featured).toBeNull();
        expect(replayAt(base, log, 1500).featured?.name).toBe('Lamp A');
        expect(replayAt(base, log, 6000).featured?.name).toBe('Lamp B');
    });
});
