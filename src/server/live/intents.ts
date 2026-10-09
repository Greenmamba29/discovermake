/**
 * POST /api/live/shows/:id/intents — host (and staff co-host) intents.
 *
 * Hosts never write commerce events directly (workflow 06 rule 2): each intent is validated
 * here and turned into server-signed Live Build Protocol events.
 */
import { and, eq } from 'drizzle-orm';
import type { AuctionView, DropView, HostIntent, LiveEvent } from '../../contracts/live';
import { showDisplayId } from '../../contracts/live';
import { getDb, withTx } from '../db';
import { emitEvent } from '../events/outbox';
import { auctions, builds, drops, liveEvents, liveMutes, showFeaturedBuilds, shows } from '../db/schema';
import { ApiError } from '../http';
import { actorFor, requireHost, type ShowAccess } from './access';
import { closeAuction, startAuction } from './auctions';
import { closeDrop, startDrop } from './drops';
import { appendLiveEvent, type LiveActor } from './events';
import { computeFeaturedProduct } from './featured';
import { closeRoom, ensureRoom, liveKitConfig, roomNameForShow } from './livekit';
import { answerQuestion, createPoll } from './questions';

export type IntentResult = { event: LiveEvent | null; drop?: DropView; auction?: AuctionView };

const LIVE_SYSTEM = { kind: 'system', id: 'live' } as const;

function assertNotEnded(access: ShowAccess): void {
    if (access.show.status === 'ENDED' || access.show.status === 'CANCELLED') throw new ApiError('CONFLICT', 'This show has ended.');
}

export async function handleIntent(access: ShowAccess, intent: HostIntent): Promise<IntentResult> {
    requireHost(access);
    const actor: LiveActor = actorFor(access);
    const { show } = access;

    switch (intent.intent) {
        case 'start_show': {
            if (show.status === 'LIVE') throw new ApiError('CONFLICT', 'The show is already live.');
            if (show.status !== 'SCHEDULED') throw new ApiError('CONFLICT', 'This show has ended.');
            const cfg = liveKitConfig();
            const room = cfg ? roomNameForShow(show.id) : null;
            if (cfg && room) await ensureRoom(cfg, room);
            const now = new Date();
            const event = await withTx(async (tx) => {
                const [locked] = await tx.select({ status: shows.status }).from(shows).where(eq(shows.id, show.id)).for('update');
                if (locked?.status !== 'SCHEDULED') throw new ApiError('CONFLICT', 'The show is already live.');
                await tx.update(shows).set({ status: 'LIVE', startedAt: now, livekitRoom: room }).where(eq(shows.id, show.id));
                return appendLiveEvent(
                    show.id,
                    {
                        event: 'show.started',
                        actor,
                        payload: { startedAt: now.toISOString(), displayId: showDisplayId(show.displayNumber), source: room ? 'livekit' : show.hlsUrl ? 'hls' : 'none' },
                        at: now,
                        domain: { type: 'live.show_started', payload: { showId: show.id, channelId: show.channelId, displayId: showDisplayId(show.displayNumber) }, actor: LIVE_SYSTEM, correlationId: show.id },
                    },
                    tx,
                );
            });
            return { event };
        }
        case 'end_show': {
            if (show.status !== 'LIVE') throw new ApiError('CONFLICT', 'Only a live show can end.');
            const now = new Date();
            const event = await withTx(async (tx) => {
                const [locked] = await tx.select({ status: shows.status, startedAt: shows.startedAt }).from(shows).where(eq(shows.id, show.id)).for('update');
                if (locked?.status !== 'LIVE') throw new ApiError('CONFLICT', 'Only a live show can end.');
                await tx.update(shows).set({ status: 'ENDED', endedAt: now, viewerCount: 0 }).where(eq(shows.id, show.id));
                const durationMs = locked.startedAt ? Math.max(0, now.getTime() - locked.startedAt.getTime()) : 0;
                return appendLiveEvent(
                    show.id,
                    {
                        event: 'show.ended',
                        actor,
                        payload: { endedAt: now.toISOString(), durationMs },
                        at: now,
                        domain: { type: 'live.show_ended', payload: { showId: show.id, channelId: show.channelId, displayId: showDisplayId(show.displayNumber), durationMs }, actor: LIVE_SYSTEM, correlationId: show.id },
                    },
                    tx,
                );
            });
            const cfg = liveKitConfig();
            if (cfg && show.livekitRoom) await closeRoom(cfg, show.livekitRoom);
            // R5 clip engine: the system clips each product moment of the replay (best effort, idempotent).
            try {
                const { autoCreateClips } = await import('../media/clips');
                await autoCreateClips(show.id);
            } catch (err) {
                console.error('[live] auto clips failed', err);
            }
            return { event };
        }
        case 'feature_product': {
            assertNotEnded(access);
            const [build] = await getDb().select({ id: builds.id }).from(builds).where(eq(builds.id, intent.buildId)).limit(1);
            if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
            const featured = await computeFeaturedProduct(intent.buildId);
            const event = await withTx(async (tx) => {
                await tx.insert(showFeaturedBuilds).values({ showId: show.id, buildId: intent.buildId, position: 99 }).onConflictDoNothing();
                await tx.update(shows).set({ featuredBuildId: intent.buildId }).where(eq(shows.id, show.id));
                const e = await appendLiveEvent(
                    show.id,
                    { event: 'product.focus', actor, buildId: featured.buildId, designVersion: featured.designVersion, payload: featured as unknown as Record<string, unknown> },
                    tx,
                );
                // Mirrored with the assigned seq.
                await emitEvent(tx, { type: 'live.product_featured', payload: { showId: show.id, buildId: featured.buildId, seq: e.seq }, actor: LIVE_SYSTEM, correlationId: show.id, buildId: featured.buildId });
                return e;
            });
            return { event };
        }
        case 'start_drop': {
            assertNotEnded(access);
            const drop = await startDrop(access, intent, actor);
            return { event: null, drop };
        }
        case 'close_drop': {
            const [open] = await getDb()
                .select({ id: drops.id })
                .from(drops)
                .where(and(eq(drops.showId, show.id), eq(drops.status, 'OPEN')))
                .limit(1);
            if (!open) throw new ApiError('CONFLICT', 'There is no open drop on this show.');
            const drop = await closeDrop(open.id, actor, 'host');
            return { event: null, drop };
        }
        case 'answer_question': {
            const event = await answerQuestion(access, intent.questionId, intent.answer, actor);
            return { event };
        }
        case 'create_poll': {
            assertNotEnded(access);
            const event = await createPoll(access, { question: intent.question, options: intent.options }, actor);
            return { event };
        }
        case 'remove_chat': {
            const [target] = await getDb()
                .select({ event: liveEvents.event })
                .from(liveEvents)
                .where(and(eq(liveEvents.showId, show.id), eq(liveEvents.seq, intent.eventSeq)))
                .limit(1);
            if (!target || target.event !== 'chat.message') throw new ApiError('NOT_FOUND', 'Chat message not found');
            const event = await appendLiveEvent(show.id, { event: 'chat.removed', actor, payload: { eventSeq: intent.eventSeq } });
            return { event };
        }
        case 'mute_viewer': {
            if (intent.viewerId === access.viewer.user.id) throw new ApiError('CONFLICT', 'You cannot mute yourself.');
            if (access.channel.ownerUserId === intent.viewerId) throw new ApiError('CONFLICT', 'The host cannot be muted.');
            const until = new Date(Date.now() + intent.minutes * 60_000);
            await getDb()
                .insert(liveMutes)
                .values({ showId: show.id, userId: intent.viewerId, until, createdBy: actor.id })
                .onConflictDoUpdate({ target: [liveMutes.showId, liveMutes.userId], set: { until, createdBy: actor.id } });
            return { event: null };
        }
        case 'slow_mode': {
            assertNotEnded(access);
            await getDb().update(shows).set({ slowModeSeconds: intent.seconds }).where(eq(shows.id, show.id));
            const text = intent.seconds > 0 ? `Slow mode is on: one message every ${intent.seconds} s.` : 'Slow mode is off.';
            const event = await appendLiveEvent(show.id, { event: 'chat.message', actor: { kind: 'system', id: 'moderation', name: 'Moderation' }, payload: { text, system: true, slowModeSeconds: intent.seconds } });
            return { event };
        }
        case 'start_auction': {
            assertNotEnded(access);
            const auction = await startAuction(access, intent, actor);
            return { event: null, auction };
        }
        case 'close_auction': {
            const [open] = await getDb()
                .select({ id: auctions.id })
                .from(auctions)
                .where(and(eq(auctions.showId, show.id), eq(auctions.status, 'OPEN')))
                .limit(1);
            if (!open) throw new ApiError('CONFLICT', 'There is no running auction on this show.');
            const auction = await closeAuction(open.id, actor, 'host');
            return { event: null, auction };
        }
        case 'machine_milestone': {
            if (show.status !== 'LIVE') throw new ApiError('CONFLICT', 'Production milestones are posted during a live show.');
            const event = await appendLiveEvent(show.id, { event: intent.event, actor, buildId: show.featuredBuildId, payload: { note: intent.note ?? null } });
            return { event };
        }
    }
}
