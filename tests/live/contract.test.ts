import { describe, expect, it } from 'vitest';
import { HostIntent, LiveEvent, ShowDisplayId, VideoSource } from '@/contracts/live';

const base = {
    v: 1 as const,
    showId: 'shw_abc',
    seq: 1,
    streamTsMs: 0,
    actor: { kind: 'system' as const, id: 'server', name: null },
    payload: {},
    at: '2026-10-09T19:00:00.000Z',
};

describe('Live contract', () => {
    it('rejects commerce events without a signature', () => {
        expect(LiveEvent.safeParse({ ...base, event: 'price.change' }).success).toBe(false);
        expect(LiveEvent.safeParse({ ...base, event: 'price.change', sig: 'abc' }).success).toBe(true);
        expect(LiveEvent.safeParse({ ...base, event: 'chat.message' }).success).toBe(true);
    });

    it('rejects a drop threshold above its total slots', () => {
        const drop = { intent: 'start_drop', buildId: 'bld_x1', priceCents: 1000, totalSlots: 100, durationMinutes: 30 };
        expect(HostIntent.safeParse({ ...drop, thresholdSlots: 101 }).success).toBe(false);
        expect(HostIntent.safeParse({ ...drop, thresholdSlots: 100 }).success).toBe(true);
    });

    it('types show display ids and media URLs', () => {
        expect(ShowDisplayId.safeParse('LIVE-984').success).toBe(true);
        expect(ShowDisplayId.safeParse('').success).toBe(false);
        expect(VideoSource.safeParse({ kind: 'mp4', url: '/media/replay.mp4' }).success).toBe(true);
        expect(VideoSource.safeParse({ kind: 'mp4', url: 'https://cdn.example.com/r.mp4' }).success).toBe(true);
        expect(VideoSource.safeParse({ kind: 'mp4', url: 'not a url' }).success).toBe(false);
        expect(VideoSource.safeParse({ kind: 'mp4', url: '//evil.example/r.mp4' }).success).toBe(false);
    });
});
