/**
 * Channels (creator / factory / campus) and follows.
 */
import { and, count, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { ChannelPageResponse, ChannelView, FollowChannelResponse, UpsertChannelRequest } from '../../contracts/live';
import { hasRole, type ViewerContext } from '../auth/viewer';
import { getDb } from '../db';
import { channelFollows, channels, shows } from '../db/schema';
import { ApiError } from '../http';
import { loadChannelViews, toShowViews, type ChannelRow } from './views';

export async function channelForOwner(userId: string): Promise<ChannelRow | null> {
    const [row] = await getDb().select().from(channels).where(eq(channels.ownerUserId, userId)).limit(1);
    return row ?? null;
}

export async function channelByHandle(handle: string): Promise<ChannelRow | null> {
    const [row] = await getDb().select().from(channels).where(eq(channels.handle, handle.toLowerCase())).limit(1);
    return row ?? null;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
    const e = err as { code?: string; constraint_name?: string; cause?: unknown };
    if (e?.code === '23505' && e.constraint_name === constraint) return true;
    return e?.cause ? isUniqueViolation(e.cause, constraint) : false;
}

/** Create or update the viewer's own channel (creator role). One channel per user. */
export async function upsertChannel(viewer: ViewerContext, input: z.infer<typeof UpsertChannelRequest>): Promise<ChannelView> {
    if (!hasRole(viewer, 'creator')) throw new ApiError('FORBIDDEN', 'Become a creator before setting up a channel.', 403);
    if (input.kind === 'factory' && !hasRole(viewer, 'shop') && !hasRole(viewer, 'admin')) throw new ApiError('FORBIDDEN', 'Factory channels belong to partner shops.', 403);
    const db = getDb();
    const existing = await channelForOwner(viewer.user.id);
    const values = {
        name: input.name,
        handle: input.handle.toLowerCase(),
        kind: input.kind,
        categories: input.categories,
        bio: input.bio?.trim() || null,
        ownerUserId: viewer.user.id,
        ownerDisplayName: viewer.user.displayName,
        ownerEmail: viewer.user.email,
    };
    try {
        const [row] = existing
            ? await db.update(channels).set(values).where(eq(channels.id, existing.id)).returning()
            : await db.insert(channels).values(values).returning();
        const view = (await loadChannelViews([row.id], viewer.user.id)).get(row.id);
        if (!view) throw new ApiError('INTERNAL', 'Channel could not be loaded');
        return view;
    } catch (err) {
        if (isUniqueViolation(err, 'channels_handle_uq')) throw new ApiError('CONFLICT', `The handle @${values.handle} is taken. Pick another one.`);
        throw err;
    }
}

export async function setFollow(channelId: string, viewer: ViewerContext, follow: boolean): Promise<FollowChannelResponse> {
    const db = getDb();
    const [channel] = await db.select({ id: channels.id, ownerUserId: channels.ownerUserId }).from(channels).where(eq(channels.id, channelId)).limit(1);
    if (!channel) throw new ApiError('NOT_FOUND', 'Channel not found');
    if (follow) {
        if (channel.ownerUserId === viewer.user.id) throw new ApiError('CONFLICT', 'You cannot follow your own channel.');
        await db.insert(channelFollows).values({ channelId, userId: viewer.user.id }).onConflictDoNothing();
    } else {
        await db.delete(channelFollows).where(and(eq(channelFollows.channelId, channelId), eq(channelFollows.userId, viewer.user.id)));
    }
    const [c] = await db.select({ n: count() }).from(channelFollows).where(eq(channelFollows.channelId, channelId));
    return { following: follow, followerCount: Number(c?.n ?? 0) };
}

export async function channelPage(handle: string, viewerId: string | null): Promise<ChannelPageResponse | null> {
    const row = await channelByHandle(handle);
    if (!row) return null;
    const view = (await loadChannelViews([row.id], viewerId)).get(row.id)!;
    const rows = await getDb().select().from(shows).where(eq(shows.channelId, row.id)).orderBy(desc(shows.scheduledFor)).limit(60);
    const all = await toShowViews(rows, viewerId);
    return {
        channel: view,
        live: all.filter((s) => s.status === 'LIVE'),
        upcoming: all.filter((s) => s.status === 'SCHEDULED').reverse(),
        replays: all.filter((s) => s.status === 'ENDED'),
    };
}
