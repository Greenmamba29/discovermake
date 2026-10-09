/**
 * Likes, join tokens, LiveKit webhooks and the Creator Studio control room.
 */
import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { ControlRoomView, LiveStats, LiveTokenResponse } from '../../contracts/live';
import { getDeviceHash } from '../auth/viewer';
import { getDb, withTx } from '../db';
import { drops, liveEvents, liveMutes, liveQuestions, showLikes, shows, slotClaims } from '../db/schema';
import { ApiError } from '../http';
import { randomBase32 } from '../ids';
import { actorFor, publicName, requireHost, requireSignedIn, type ShowAccess } from './access';
import { appendLiveEvent } from './events';
import { createLiveKitToken, isLiveKitConfigured, liveKitConfig, LIVEKIT_TOKEN_TTL_SECONDS, roomNameForShow, type LiveRole } from './livekit';
import { setViewerCount } from './presence';
import { featuredProductsFor, goLiveChecklist } from './shows';
import { buildSnapshot } from './snapshot';
import { videoSourceFor } from './views';

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

/** One like per signed-in viewer; the first like increments the count and emits `reaction.like`. */
export async function likeShow(access: ShowAccess): Promise<{ likeCount: number }> {
    requireSignedIn(access);
    if (access.show.status === 'CANCELLED') throw new ApiError('CONFLICT', 'This show was cancelled.');
    return withTx(async (tx) => {
        const inserted = await tx.insert(showLikes).values({ showId: access.show.id, userId: access.viewer.user.id }).onConflictDoNothing().returning();
        if (!inserted.length) {
            const [s] = await tx.select({ likeCount: shows.likeCount }).from(shows).where(eq(shows.id, access.show.id));
            return { likeCount: s?.likeCount ?? 0 };
        }
        const [s] = await tx
            .update(shows)
            .set({ likeCount: sql`${shows.likeCount} + 1` })
            .where(eq(shows.id, access.show.id))
            .returning({ likeCount: shows.likeCount });
        await appendLiveEvent(access.show.id, { event: 'reaction.like', actor: actorFor(access), payload: { likeCount: s.likeCount } }, tx);
        return { likeCount: s.likeCount };
    });
}

// ---------------------------------------------------------------------------
// Join tokens
// ---------------------------------------------------------------------------

/**
 * Join credentials. LiveKit JWTs only when LiveKit is configured and the show has a room
 * (hosts may also join their SCHEDULED show's room to check camera and mic).
 * Identity: the user id, or an anonymous id derived from the device (never an email).
 */
export async function issueJoinToken(request: Request, access: ShowAccess): Promise<LiveTokenResponse> {
    const role: LiveRole = access.role === 'host' ? 'host' : access.role === 'cohost' ? 'cohost' : 'viewer';
    const source = videoSourceFor(access.show);
    const cfg = liveKitConfig();
    const fallbackExpiry = new Date(Date.now() + LIVEKIT_TOKEN_TTL_SECONDS * 1000).toISOString();
    if (!cfg) return { source, livekit: null, role, expiresAt: fallbackExpiry };
    const hostPrejoin = role !== 'viewer' && access.show.status === 'SCHEDULED';
    const room = access.show.livekitRoom ?? (hostPrejoin ? roomNameForShow(access.show.id) : null);
    if (!room || (access.show.status !== 'LIVE' && !hostPrejoin)) return { source, livekit: null, role, expiresAt: fallbackExpiry };
    const device = getDeviceHash(request);
    const identity = access.viewer ? access.viewer.user.id : `anon-${device ? device.slice(0, 16) : randomBase32(16).toLowerCase()}`;
    const { token, expiresAt } = await createLiveKitToken(cfg, { room, role, identity, name: access.viewer ? publicName(access.viewer) : 'Viewer' });
    return { source: { kind: 'livekit', roomName: room }, livekit: { url: cfg.url, token }, role, expiresAt: expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// LiveKit webhooks
// ---------------------------------------------------------------------------

type LiveKitWebhookLike = {
    event: string;
    room?: { name?: string; numParticipants?: number } | undefined;
    egressInfo?: { roomName?: string; fileResults?: { location?: string }[]; segmentResults?: { playlistLocation?: string }[] } | undefined;
};

/** Apply a verified LiveKit webhook: viewer counts, room finished, egress (replay) URLs. */
export async function applyLiveKitWebhook(event: LiveKitWebhookLike): Promise<{ showId: string | null; applied: string }> {
    const roomName = event.room?.name ?? event.egressInfo?.roomName ?? null;
    if (!roomName) return { showId: null, applied: 'ignored' };
    const [show] = await getDb().select().from(shows).where(eq(shows.livekitRoom, roomName)).limit(1);
    if (!show) return { showId: null, applied: 'ignored' };
    switch (event.event) {
        case 'participant_joined':
        case 'participant_left': {
            const n = Math.max(0, Number(event.room?.numParticipants ?? 0));
            await setViewerCount(show.id, n);
            return { showId: show.id, applied: 'viewer_count' };
        }
        case 'room_finished':
            if (show.status === 'LIVE') await setViewerCount(show.id, 0);
            return { showId: show.id, applied: 'room_finished' };
        case 'egress_ended': {
            const url = event.egressInfo?.segmentResults?.[0]?.playlistLocation || event.egressInfo?.fileResults?.[0]?.location || null;
            if (!url) return { showId: show.id, applied: 'egress_without_output' };
            await getDb().update(shows).set({ replayUrl: url }).where(eq(shows.id, show.id));
            return { showId: show.id, applied: 'replay_url' };
        }
        default:
            return { showId: show.id, applied: 'ignored' };
    }
}

// ---------------------------------------------------------------------------
// Control room
// ---------------------------------------------------------------------------

export async function liveStats(showId: string, viewerCount: number, peakViewers: number, likeCount: number): Promise<LiveStats> {
    const db = getDb();
    const [chat] = await db.select({ n: count() }).from(liveEvents).where(and(eq(liveEvents.showId, showId), eq(liveEvents.event, 'chat.message')));
    const [questions] = await db.select({ n: count() }).from(liveQuestions).where(eq(liveQuestions.showId, showId));
    const [open] = await db
        .select({ n: count() })
        .from(liveQuestions)
        .where(and(eq(liveQuestions.showId, showId), eq(liveQuestions.mode, 'creator'), isNull(liveQuestions.answer)));
    const [slots] = await db
        .select({
            slots: sql<number>`coalesce(sum(${slotClaims.quantity}), 0)::int`,
            orders: sql<number>`count(${slotClaims.id})::int`,
            revenue: sql<number>`coalesce(sum(${slotClaims.quantity} * ${drops.priceCents}), 0)::int`,
        })
        .from(slotClaims)
        .innerJoin(drops, eq(drops.id, slotClaims.dropId))
        .where(and(eq(drops.showId, showId), inArray(slotClaims.status, ['RESERVED', 'AUTHORIZED', 'CAPTURED'])));
    return {
        viewerCount,
        peakViewers,
        likeCount,
        chatCount: Number(chat?.n ?? 0),
        questionCount: Number(questions?.n ?? 0),
        openQuestionCount: Number(open?.n ?? 0),
        slotsClaimed: Number(slots?.slots ?? 0),
        orderCount: Number(slots?.orders ?? 0),
        slotRevenueCents: Number(slots?.revenue ?? 0),
    };
}

export async function buildControlRoom(access: ShowAccess): Promise<ControlRoomView> {
    requireHost(access);
    const snapshot = await buildSnapshot(access);
    const featuredBuilds = await featuredProductsFor(access.show.id);
    const [fresh] = await getDb().select().from(shows).where(eq(shows.id, access.show.id));
    const show = fresh ?? access.show;
    const mutes = await getDb()
        .select({ userId: liveMutes.userId, until: liveMutes.until })
        .from(liveMutes)
        .where(and(eq(liveMutes.showId, show.id), gt(liveMutes.until, new Date())));
    return {
        snapshot,
        featuredBuilds,
        checklist: await goLiveChecklist({ hasChannel: true, show, featured: featuredBuilds }),
        stats: await liveStats(show.id, show.viewerCount, show.peakViewers, show.likeCount),
        mutes: mutes.map((m) => ({ userId: m.userId, until: m.until.toISOString() })),
        hlsUrl: show.hlsUrl,
        livekitConfigured: isLiveKitConfigured(),
    };
}
