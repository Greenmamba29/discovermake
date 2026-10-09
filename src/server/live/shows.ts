/**
 * Shows: create / update (channel owner), Live home, Creator Studio overview, go-live checklist.
 */
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { CHANNEL_CATEGORIES, type ChannelCategory, type CreateShowRequest, type FeaturedProduct, type GoLiveChecklist, type LiveHomeResponse, type ShowView, type StudioOverview, type UpdateShowRequest } from '../../contracts/live';
import { hasRole, type ViewerContext } from '../auth/viewer';
import { getDb, withTx } from '../db';
import { builds, channels, showFeaturedBuilds, shows } from '../db/schema';
import { ApiError } from '../http';
import { channelForOwner } from './channels';
import { computeFeaturedProduct } from './featured';
import { isLiveKitConfigured } from './livekit';
import { loadChannelViews, toShowViews, type ShowRow } from './views';

async function assertBuildsExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await getDb().select({ id: builds.id }).from(builds).where(inArray(builds.id, ids));
    const have = new Set(found.map((b) => b.id));
    const missing = ids.filter((id) => !have.has(id));
    if (missing.length) throw new ApiError('VALIDATION_FAILED', `Unknown build${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
}

async function setFeaturedBuilds(tx: Parameters<Parameters<typeof withTx>[0]>[0], showId: string, ids: string[]): Promise<void> {
    await tx.delete(showFeaturedBuilds).where(eq(showFeaturedBuilds.showId, showId));
    const unique = [...new Set(ids)];
    if (unique.length) await tx.insert(showFeaturedBuilds).values(unique.map((buildId, position) => ({ showId, buildId, position })));
}

export async function createShow(viewer: ViewerContext, input: z.infer<typeof CreateShowRequest>): Promise<ShowView> {
    const channel = await channelForOwner(viewer.user.id);
    if (!channel) throw new ApiError('CONFLICT', 'Set up your channel before scheduling a show.');
    await assertBuildsExist(input.featuredBuildIds);
    const row = await withTx(async (tx) => {
        const [show] = await tx
            .insert(shows)
            .values({ channelId: channel.id, title: input.title, format: input.format, scheduledFor: new Date(input.scheduledFor), hlsUrl: input.hlsUrl ?? null, createdBy: viewer.user.id })
            .returning();
        await setFeaturedBuilds(tx, show.id, input.featuredBuildIds);
        return show;
    });
    return (await toShowViews([row], viewer.user.id))[0];
}

export async function updateShow(show: ShowRow, viewer: ViewerContext, input: UpdateShowRequest): Promise<ShowView> {
    if (show.status === 'ENDED' || show.status === 'CANCELLED') throw new ApiError('CONFLICT', 'This show has ended and can no longer be changed.');
    const scheduleChange = input.title !== undefined || input.format !== undefined || input.scheduledFor !== undefined;
    if (scheduleChange && show.status !== 'SCHEDULED') throw new ApiError('CONFLICT', 'Title, format and time can only change before the show starts.');
    if (input.featuredBuildIds) await assertBuildsExist(input.featuredBuildIds);
    const row = await withTx(async (tx) => {
        const patch: Partial<typeof shows.$inferInsert> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.format !== undefined) patch.format = input.format;
        if (input.scheduledFor !== undefined) patch.scheduledFor = new Date(input.scheduledFor);
        if (input.hlsUrl !== undefined) patch.hlsUrl = input.hlsUrl;
        const [updated] = Object.keys(patch).length ? await tx.update(shows).set(patch).where(eq(shows.id, show.id)).returning() : [show];
        if (input.featuredBuildIds) await setFeaturedBuilds(tx, show.id, input.featuredBuildIds);
        return updated;
    });
    return (await toShowViews([row], viewer.user.id))[0];
}

export async function featuredBuildIds(showId: string): Promise<string[]> {
    const rows = await getDb().select({ buildId: showFeaturedBuilds.buildId }).from(showFeaturedBuilds).where(eq(showFeaturedBuilds.showId, showId)).orderBy(asc(showFeaturedBuilds.position));
    return rows.map((r) => r.buildId);
}

export async function featuredProductsFor(showId: string): Promise<FeaturedProduct[]> {
    const ids = await featuredBuildIds(showId);
    const out: FeaturedProduct[] = [];
    for (const id of ids) {
        try {
            out.push(await computeFeaturedProduct(id));
        } catch {
            // A build that disappeared is skipped.
        }
    }
    return out;
}

export async function liveHome(viewerId: string | null, category: ChannelCategory | null, now: Date = new Date()): Promise<LiveHomeResponse> {
    const db = getDb();
    const inCategory = category ? sql`${channels.categories} @> ${JSON.stringify([category])}::jsonb` : sql`true`;
    const base = db.select({ show: shows }).from(shows).innerJoin(channels, eq(channels.id, shows.channelId));
    const [live, upcoming, replays] = await Promise.all([
        base.where(and(eq(shows.status, 'LIVE'), inCategory)).orderBy(desc(shows.viewerCount), desc(shows.startedAt)).limit(24),
        db
            .select({ show: shows })
            .from(shows)
            .innerJoin(channels, eq(channels.id, shows.channelId))
            .where(and(eq(shows.status, 'SCHEDULED'), gte(shows.scheduledFor, new Date(now.getTime() - 6 * 3600_000)), inCategory))
            .orderBy(asc(shows.scheduledFor))
            .limit(24),
        db
            .select({ show: shows })
            .from(shows)
            .innerJoin(channels, eq(channels.id, shows.channelId))
            .where(and(eq(shows.status, 'ENDED'), inCategory))
            .orderBy(desc(shows.endedAt))
            .limit(24),
    ]);
    const all = await toShowViews([...live, ...upcoming, ...replays].map((r) => r.show), viewerId);
    const byId = new Map(all.map((s) => [s.id, s]));
    const pick = (rows: { show: ShowRow }[]) => rows.map((r) => byId.get(r.show.id)).filter((s): s is ShowView => !!s);
    return { live: pick(live), upcoming: pick(upcoming), replays: pick(replays), categories: [...CHANNEL_CATEGORIES] };
}

export async function goLiveChecklist(input: { hasChannel: boolean; show: ShowRow | null; featured: FeaturedProduct[] }): Promise<GoLiveChecklist> {
    const videoReady = isLiveKitConfigured() || !!input.show?.hlsUrl;
    const items: GoLiveChecklist['items'] = [
        { key: 'channel', label: 'Set up your channel', done: input.hasChannel, hint: input.hasChannel ? null : 'Pick a name, a handle and up to three categories.' },
        {
            key: 'featured_product',
            label: 'Add a product to feature',
            done: input.featured.length > 0,
            hint: input.featured.length > 0 ? null : 'Add at least one of your builds to the show.',
        },
        {
            key: 'orderable_quote',
            label: 'Have a binding quote viewers can buy',
            done: input.featured.some((f) => f.canBuy),
            hint: input.featured.some((f) => f.canBuy) ? null : 'Buy and Build Slots need an orderable BINDING quote for the build.',
        },
        {
            key: 'video_source',
            label: 'Connect a video source',
            done: videoReady,
            hint: videoReady ? null : 'Add an HLS URL (Owncast / MediaMTX), or connect LiveKit for browser and phone publishing. Without one, viewers see a poster while commerce still runs.',
        },
        { key: 'moderation', label: 'Moderation is on', done: true, hint: 'Keyword and link filters are always on; slow mode and mutes are in the control room.' },
        { key: 'payouts', label: 'Creator payouts', done: false, hint: 'Creator commissions and Stripe Connect payouts arrive in Stage 4. Drops already settle production to the partner shop.' },
    ];
    const required = new Set(['channel', 'featured_product']);
    return { items, ready: items.filter((i) => required.has(i.key)).every((i) => i.done) };
}

export async function studioOverview(viewer: ViewerContext): Promise<StudioOverview> {
    const channel = await channelForOwner(viewer.user.id);
    const viewerInfo = { id: viewer.user.id, displayName: viewer.user.displayName, handle: viewer.user.handle, isCreator: hasRole(viewer, 'creator') };
    if (!channel) {
        return { viewer: viewerInfo, channel: null, shows: [], checklist: await goLiveChecklist({ hasChannel: false, show: null, featured: [] }), nextShowId: null };
    }
    const rows = await getDb().select().from(shows).where(eq(shows.channelId, channel.id)).orderBy(desc(shows.scheduledFor)).limit(50);
    const views = await toShowViews(rows, viewer.user.id);
    const next = rows.filter((r) => r.status === 'LIVE')[0] ?? [...rows].reverse().find((r) => r.status === 'SCHEDULED') ?? null;
    const featured = next ? await featuredProductsFor(next.id) : [];
    const channelView = (await loadChannelViews([channel.id], viewer.user.id)).get(channel.id) ?? null;
    return { viewer: viewerInfo, channel: channelView, shows: views, checklist: await goLiveChecklist({ hasChannel: true, show: next, featured }), nextShowId: next?.id ?? null };
}
