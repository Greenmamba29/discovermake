/**
 * Clip engine (workflow 07 "Clip Engine", R5 scope): a clip is (show, startMs, endMs, title,
 * featured build) pointing into the show's replay. Nothing is transcoded: the player seeks.
 *
 *   suggestClips    one window per `product.focus` / `drop.started` / `auction.started` event
 *   replayChapters  the replay's chapter list (shareable as `/live/:showId?t=<seconds>`)
 *   createClip      the host cuts a clip from an ENDED show
 *   autoCreateClips the system clips each product moment when a show ends (idempotent per event)
 */
import 'server-only';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { LiveEvent } from '../../contracts/live';
import { showDisplayId } from '../../contracts/live';
import { CLIP_MAX_MS, CLIP_MIN_MS, type ClipCard, type ClipSuggestion, type CreateClipRequest, type ReplayChapter, type ShowClipsResponse } from '../../contracts/media';
import type { ViewerContext } from '../auth/viewer';
import { getDb, withTx, type DbOrTx } from '../db';
import { buildPublications, builds, channels, clips, shows } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { listLiveEvents } from '../live/events';
import { roleFor } from '../live/access';
import { videoSourceFor } from '../live/views';
import { loadBuildCommerce } from './cards';

type ClipRow = typeof clips.$inferSelect;
type ShowRow = typeof shows.$inferSelect;

/** Default clip length after a product moment (the Clip Engine cuts 15 / 30 / 60 s). */
export const SUGGESTED_CLIP_MS = 30_000;
/** Lead-in before the moment. */
export const CLIP_LEAD_IN_MS = 2_000;
const MOMENT_EVENTS = ['product.focus', 'drop.started', 'auction.started'] as const;
const CHAPTER_EVENTS = ['show.started', 'product.focus', 'drop.started', 'drop.closed', 'auction.started', 'auction.closed', 'machine.started', 'machine.completed', 'inspection.passed', 'prototype.completed'] as const;

function payloadName(e: Pick<LiveEvent, 'event' | 'payload'>): string | null {
    const p = e.payload as Record<string, unknown>;
    if (e.event === 'product.focus' && typeof p.name === 'string') return p.name;
    const nested = (p.drop ?? p.auction) as { title?: unknown } | undefined;
    if (nested && typeof nested.title === 'string') return nested.title;
    return null;
}

/**
 * Pure: windows from the event log. A product window runs from just before its focus to the next
 * focus (or the show end), capped at 30 s; drops and auctions get the same treatment.
 */
export function suggestClips(events: Pick<LiveEvent, 'event' | 'seq' | 'streamTsMs' | 'buildId' | 'payload'>[], showEndMs: number | null): ClipSuggestion[] {
    const moments = events.filter((e) => (MOMENT_EVENTS as readonly string[]).includes(e.event)).sort((a, b) => a.seq - b.seq);
    const focusTimes = moments.filter((e) => e.event === 'product.focus').map((e) => e.streamTsMs);
    const end = showEndMs ?? Number.POSITIVE_INFINITY;
    return moments.map((e) => {
        const startMs = Math.max(0, e.streamTsMs - CLIP_LEAD_IN_MS);
        const nextFocus = focusTimes.find((t) => t > e.streamTsMs) ?? end;
        const natural = e.event === 'product.focus' ? nextFocus : end;
        let endMs = Math.min(natural, e.streamTsMs + SUGGESTED_CLIP_MS, startMs + CLIP_MAX_MS);
        if (!Number.isFinite(endMs) || endMs - startMs < CLIP_MIN_MS) endMs = startMs + Math.max(CLIP_MIN_MS, Math.min(SUGGESTED_CLIP_MS, Number.isFinite(end) ? end - startMs : SUGGESTED_CLIP_MS));
        const name = payloadName(e);
        const title = e.event === 'product.focus' ? `Now showing: ${name ?? 'the build'}` : e.event === 'drop.started' ? `Drop: ${name ?? 'Build Slots'}` : `Auction: ${name ?? 'one of one'}`;
        return { startMs, endMs, title: title.slice(0, 100), buildId: e.buildId ?? null, reason: e.event as ClipSuggestion['reason'], eventSeq: e.seq };
    });
}

export function replayChapters(events: Pick<LiveEvent, 'event' | 'streamTsMs' | 'buildId' | 'payload'>[]): ReplayChapter[] {
    const out: ReplayChapter[] = [];
    for (const e of events) {
        if (!(CHAPTER_EVENTS as readonly string[]).includes(e.event)) continue;
        const name = payloadName(e);
        const milestone = e.event.startsWith('machine.') || e.event === 'inspection.passed' || e.event === 'prototype.completed';
        const title =
            e.event === 'show.started'
                ? 'Show starts'
                : e.event === 'product.focus'
                  ? (name ?? 'New product')
                  : e.event === 'drop.started'
                    ? `Drop opens${name ? `: ${name}` : ''}`
                    : e.event === 'drop.closed'
                      ? 'Drop closes'
                      : e.event === 'auction.started'
                        ? `Auction${name ? `: ${name}` : ''}`
                        : e.event === 'auction.closed'
                          ? 'Auction ends'
                          : e.event.replace('.', ' ').replace(/^\w/, (c) => c.toUpperCase());
        out.push({ atMs: e.streamTsMs, title: title.slice(0, 100), kind: milestone ? 'milestone' : (e.event as ReplayChapter['kind']), buildId: e.buildId ?? null });
    }
    return out;
}

function showEndMs(show: Pick<ShowRow, 'startedAt' | 'endedAt'>): number | null {
    return show.startedAt && show.endedAt ? Math.max(0, show.endedAt.getTime() - show.startedAt.getTime()) : null;
}

/** The product in focus at `atMs` (latest `product.focus` at or before it, else the first one after). */
function focusAt(events: Pick<LiveEvent, 'event' | 'streamTsMs' | 'buildId'>[], startMs: number, endMs: number): { buildId: string | null; atMs: number } {
    const focus = events.filter((e) => e.event === 'product.focus' && e.buildId);
    const before = focus.filter((e) => e.streamTsMs <= endMs).pop();
    if (before) return { buildId: before.buildId ?? null, atMs: Math.max(startMs, before.streamTsMs) };
    return { buildId: null, atMs: startMs };
}

export async function clipCards(rows: ClipRow[], db: DbOrTx = getDb()): Promise<ClipCard[]> {
    if (!rows.length) return [];
    const showIds = [...new Set(rows.map((r) => r.showId))];
    const buildIds = [...new Set(rows.map((r) => r.buildId).filter((b): b is string => !!b))];
    const [showRows, buildRows, pubRows, commerce] = await Promise.all([
        db.select().from(shows).where(inArray(shows.id, showIds)),
        buildIds.length ? db.select({ id: builds.id, displayId: builds.displayId, name: builds.name }).from(builds).where(inArray(builds.id, buildIds)) : [],
        buildIds.length ? db.select().from(buildPublications).where(inArray(buildPublications.buildId, buildIds)) : [],
        loadBuildCommerce(buildIds, db),
    ]);
    const channelRows = await db.select().from(channels).where(inArray(channels.id, [...new Set(showRows.map((s) => s.channelId))]));
    const showBy = new Map(showRows.map((s) => [s.id, s]));
    const channelBy = new Map(channelRows.map((c) => [c.id, c]));
    const buildBy = new Map(buildRows.map((b) => [b.id, b]));
    const pubBy = new Map(pubRows.map((p) => [p.buildId, p]));
    return rows.flatMap((r) => {
        const show = showBy.get(r.showId);
        const channel = show ? channelBy.get(show.channelId) : null;
        if (!show || !channel) return [];
        const b = r.buildId ? buildBy.get(r.buildId) : null;
        const pub = r.buildId ? pubBy.get(r.buildId) : null;
        const c = r.buildId ? commerce.get(r.buildId) : null;
        const isPublic = pub?.visibility === 'public';
        return [
            {
                id: r.id,
                showId: show.id,
                showDisplayId: showDisplayId(show.displayNumber),
                showTitle: show.title,
                title: r.title,
                startMs: r.startMs,
                endMs: r.endMs,
                source: videoSourceFor(show),
                channel: { handle: channel.handle, name: channel.name, kind: channel.kind },
                build: b
                    ? {
                          buildId: b.id,
                          displayId: b.displayId,
                          title: isPublic ? pub!.title : b.name,
                          priceCents: c?.quote?.unitPriceCents ?? null,
                          quoteId: c?.quote?.id ?? null,
                          partId: c?.part?.id ?? null,
                          canBuy: !!c?.quote,
                          published: isPublic,
                      }
                    : null,
                productAtMs: Math.max(0, Math.min(r.endMs - r.startMs, (r.productAtMs ?? r.startMs) - r.startMs)),
                origin: r.origin,
                createdAt: r.createdAt.toISOString(),
            },
        ];
    });
}

export async function getClip(clipId: string): Promise<ClipCard | null> {
    const [row] = await getDb().select().from(clips).where(eq(clips.id, clipId)).limit(1);
    if (!row) return null;
    const [card] = await clipCards([row]);
    return card ?? null;
}

export async function clipsForBuild(buildId: string, limit = 6): Promise<ClipCard[]> {
    const rows = await getDb().select().from(clips).where(eq(clips.buildId, buildId)).orderBy(desc(clips.createdAt)).limit(limit);
    return clipCards(rows);
}

async function loadShowWithChannel(showId: string): Promise<{ show: ShowRow; channel: typeof channels.$inferSelect }> {
    const db = getDb();
    const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
    if (!show) throw new ApiError('NOT_FOUND', 'Show not found');
    const [channel] = await db.select().from(channels).where(eq(channels.id, show.channelId)).limit(1);
    if (!channel) throw new ApiError('NOT_FOUND', 'Show not found');
    return { show, channel };
}

export async function showClips(showId: string, viewer: ViewerContext | null): Promise<ShowClipsResponse> {
    const { show, channel } = await loadShowWithChannel(showId);
    const role = roleFor(channel, viewer);
    const isHost = role === 'host' || role === 'cohost';
    const events = await listLiveEvents(showId, { types: [...CHAPTER_EVENTS], limit: 2000 });
    const rows = await getDb().select().from(clips).where(eq(clips.showId, showId)).orderBy(asc(clips.startMs));
    return {
        showId,
        status: show.status,
        clips: await clipCards(rows),
        suggestions: isHost ? suggestClips(events, showEndMs(show)) : [],
        chapters: replayChapters(events),
        viewerIsHost: isHost,
    };
}

async function insertClip(
    tx: DbOrTx,
    show: ShowRow,
    values: { buildId: string | null; title: string; startMs: number; endMs: number; productAtMs: number; origin: 'host' | 'system'; eventSeq: number | null; createdBy: string },
): Promise<ClipRow | null> {
    let buildName = '';
    if (values.buildId) {
        const [b] = await tx.select({ name: builds.name }).from(builds).where(eq(builds.id, values.buildId));
        buildName = b?.name ?? '';
    }
    const [row] = await tx
        .insert(clips)
        .values({ showId: show.id, channelId: show.channelId, ...values, searchText: `${values.title} ${show.title} ${buildName}`.slice(0, 2000) })
        .onConflictDoNothing()
        .returning();
    if (!row) return null;
    await emitEvent(tx, {
        type: 'clip.created',
        payload: { clipId: row.id, showId: show.id, buildId: row.buildId, startMs: row.startMs, endMs: row.endMs, origin: row.origin },
        actor: values.origin === 'system' ? { kind: 'system', id: 'clip-engine' } : { kind: 'buyer', id: values.createdBy },
        correlationId: show.id,
        buildId: row.buildId,
    });
    return row;
}

/** The host cuts a clip from an ENDED show's replay. */
export async function createClip(showId: string, viewer: ViewerContext, input: CreateClipRequest): Promise<ClipCard> {
    const { show, channel } = await loadShowWithChannel(showId);
    const role = roleFor(channel, viewer);
    if (role !== 'host' && role !== 'cohost') throw new ApiError('FORBIDDEN', 'Only the host can clip this show', 403);
    if (show.status !== 'ENDED') throw new ApiError('CONFLICT', 'Clips are cut from the replay once the show has ended.');
    const length = showEndMs(show);
    if (length !== null && input.startMs >= length) throw new ApiError('VALIDATION_FAILED', 'The clip starts after the end of the show.');
    const events = await listLiveEvents(showId, { types: ['product.focus'], limit: 2000 });
    const focus = focusAt(events, input.startMs, input.endMs);
    const buildId = input.buildId ?? focus.buildId;
    const row = await withTx((tx) => insertClip(tx, show, { buildId, title: input.title, startMs: input.startMs, endMs: input.endMs, productAtMs: focus.atMs, origin: 'host', eventSeq: null, createdBy: viewer.user.id }));
    if (!row) throw new ApiError('CONFLICT', 'That clip already exists.');
    const [card] = await clipCards([row]);
    return card;
}

/** At show end: one system clip per product moment (max `limit`), idempotent per event seq. */
export async function autoCreateClips(showId: string, limit = 3): Promise<number> {
    const { show } = await loadShowWithChannel(showId);
    if (show.status !== 'ENDED') return 0;
    const events = await listLiveEvents(showId, { types: ['product.focus'], limit: 2000 });
    const suggestions = suggestClips(events, showEndMs(show)).slice(0, limit);
    let created = 0;
    await withTx(async (tx) => {
        for (const s of suggestions) {
            const row = await insertClip(tx, show, { buildId: s.buildId, title: s.title, startMs: s.startMs, endMs: s.endMs, productAtMs: s.startMs + CLIP_LEAD_IN_MS, origin: 'system', eventSeq: s.eventSeq, createdBy: 'system' });
            if (row) created++;
        }
    });
    return created;
}

/** Recent clips of shows on these channels (channel page). */
export async function clipsForChannels(channelIds: string[], limit = 12): Promise<ClipCard[]> {
    if (!channelIds.length) return [];
    const rows = await getDb().select().from(clips).where(inArray(clips.channelId, channelIds)).orderBy(desc(clips.createdAt)).limit(limit);
    return clipCards(rows);
}
