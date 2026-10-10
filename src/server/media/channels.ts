/**
 * Channel page `/c/:handle` (Whatnot seller profile): Live's channel page (shows, follows)
 * plus the owner's published builds and the channel's clips. Creator, factory and campus
 * channels share it (`channels.kind`).
 */
import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import type { ChannelMediaPage } from '../../contracts/media';
import type { ViewerContext } from '../auth/viewer';
import { getDb } from '../db';
import { buildPublications } from '../db/schema';
import { channelByHandle, channelPage } from '../live/channels';
import { buildCards } from './cards';
import { clipsForChannels } from './clips';

export async function channelMediaPage(handle: string, viewer: ViewerContext | null): Promise<ChannelMediaPage | null> {
    const page = await channelPage(handle, viewer?.user.id ?? null);
    if (!page) return null;
    const row = await channelByHandle(handle);
    if (!row) return null;
    const pubs = row.ownerUserId
        ? await getDb()
              .select()
              .from(buildPublications)
              .where(and(eq(buildPublications.ownerUserId, row.ownerUserId), eq(buildPublications.visibility, 'public')))
              .orderBy(desc(buildPublications.publishedAt))
              .limit(48)
        : [];
    const [builds, clips] = await Promise.all([buildCards(pubs), clipsForChannels([row.id], 12)]);
    return {
        channel: page.channel,
        ownerName: row.ownerDisplayName,
        viewerIsOwner: !!viewer && !!row.ownerUserId && row.ownerUserId === viewer.user.id,
        live: page.live,
        upcoming: page.upcoming,
        replays: page.replays,
        builds,
        clips,
        stats: { followers: page.channel.followerCount, publishedBuilds: builds.length, shows: page.live.length + page.upcoming.length + page.replays.length },
    };
}
