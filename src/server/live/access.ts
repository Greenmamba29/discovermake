/**
 * Who may do what on a show.
 *
 *   host       the channel owner
 *   cohost     ops / admin staff (moderation help on any show); per-show co-hosts are deferred
 *   viewer     any signed-in user
 *   anonymous  signed out (can watch, cannot write)
 */
import { ApiError } from '../http';
import { getViewer, hasRole, type ViewerContext } from '../auth/viewer';
import type { LiveActor } from './events';
import { loadChannel, loadShow, type ChannelRow, type ShowRow } from './views';

export type LiveViewerRole = 'host' | 'cohost' | 'viewer' | 'anonymous';

export type ShowAccess = {
    show: ShowRow;
    channel: ChannelRow;
    viewer: ViewerContext | null;
    role: LiveViewerRole;
};

export function roleFor(channel: Pick<ChannelRow, 'ownerUserId'>, viewer: ViewerContext | null): LiveViewerRole {
    if (!viewer) return 'anonymous';
    if (channel.ownerUserId && channel.ownerUserId === viewer.user.id) return 'host';
    if (hasRole(viewer, 'ops') || hasRole(viewer, 'admin')) return 'cohost';
    return 'viewer';
}

export async function loadShowAccess(request: Request, showId: string): Promise<ShowAccess> {
    const show = await loadShow(showId);
    if (!show) throw new ApiError('NOT_FOUND', 'Show not found');
    const channel = await loadChannel(show.channelId);
    if (!channel) throw new ApiError('NOT_FOUND', 'Show not found');
    const viewer = await getViewer(request);
    return { show, channel, viewer, role: roleFor(channel, viewer) };
}

/** 401 signed out, 403 for viewers: only the host (and staff co-hosts) send intents. */
export function requireHost(access: ShowAccess): asserts access is ShowAccess & { viewer: ViewerContext; role: 'host' | 'cohost' } {
    if (!access.viewer) throw new ApiError('UNAUTHORIZED', 'Sign in to host this show', 401);
    if (access.role !== 'host' && access.role !== 'cohost') throw new ApiError('FORBIDDEN', 'Only the host can do that', 403);
}

export function requireSignedIn(access: ShowAccess): asserts access is ShowAccess & { viewer: ViewerContext } {
    if (!access.viewer) throw new ApiError('UNAUTHORIZED', 'Sign in to join in', 401);
}

/** Public name shown next to a viewer's chat line: display name, @handle, or a neutral label. */
export function publicName(viewer: ViewerContext): string {
    const u = viewer.user;
    if (u.displayName?.trim()) return u.displayName.trim().slice(0, 40);
    if (u.handle) return `@${u.handle}`;
    return `Maker ${u.id.slice(-4).toUpperCase()}`;
}

export function actorFor(access: ShowAccess & { viewer: ViewerContext }): LiveActor {
    const kind = access.role === 'host' ? 'host' : access.role === 'cohost' ? 'cohost' : 'viewer';
    return { kind, id: access.viewer.user.id, name: publicName(access.viewer) };
}
