/**
 * What a kid may look at when their grown-up allows it:
 *   - Discover: a read-only gallery of public builds that ops marked kid-safe (kid_safe_builds).
 *     No buying, remixing, comments or tracking (feed events are not recorded in Kids mode).
 *   - Live: view-only. Subscribe-only video token as an anonymous viewer; no chat, questions,
 *     polls, drops or likes are reachable from Kids mode.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { LiveTokenResponse, ShowView } from '@/contracts/live';
import { DEVICE_COOKIE } from '@/contracts/account';
import { getDb } from '../db';
import { buildPublications, builds, kidSafeBuilds } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../http';
import { readRequestCookie } from '../auth/cookies';
import { buildSnapshot, issueJoinToken, liveHome, loadShowAccess } from '../live';
import type { KidSession } from './session';

export type KidSafeBuild = { buildId: string; title: string; description: string | null };

export async function listKidSafeBuilds(limit = 24): Promise<KidSafeBuild[]> {
    const rows = await getDb()
        .select({ buildId: buildPublications.buildId, title: buildPublications.title, description: buildPublications.description })
        .from(buildPublications)
        .innerJoin(kidSafeBuilds, eq(kidSafeBuilds.buildId, buildPublications.buildId))
        .where(eq(buildPublications.visibility, 'public'))
        .orderBy(desc(buildPublications.publishedAt))
        .limit(limit);
    return rows.map((r) => ({ ...r, description: r.description ? r.description.slice(0, 160) : null }));
}

/** Ops: mark or unmark a public build as safe for Kids mode Discover. */
export async function setKidSafe(buildId: string, kidSafe: boolean, markedBy: string): Promise<{ buildId: string; kidSafe: boolean }> {
    const db = getDb();
    const [build] = await db.select({ id: builds.id, origin: builds.origin }).from(builds).where(eq(builds.id, buildId)).limit(1);
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    if (kidSafe) await db.insert(kidSafeBuilds).values({ buildId, markedBy }).onConflictDoNothing();
    else await db.delete(kidSafeBuilds).where(and(eq(kidSafeBuilds.buildId, buildId)));
    return { buildId, kidSafe };
}

export function assertCanWatchLive(kid: KidSession): void {
    if (!kid.kid.liveViewing) throw new ApiError('FORBIDDEN', 'Ask a grown-up to turn on Live for you.', 403);
}

export function assertCanDiscover(kid: KidSession): void {
    if (!kid.kid.discoverBrowsing) throw new ApiError('FORBIDDEN', 'Ask a grown-up to turn on Discover for you.', 403);
}

export async function kidLiveShows(): Promise<ShowView[]> {
    const home = await liveHome(null, null);
    return [...home.live, ...home.upcoming].slice(0, 12);
}

/** An anonymous request (only the device cookie): the kid watches as a signed-out viewer. */
function anonymous(request: Request): Request {
    const device = readRequestCookie(request, DEVICE_COOKIE);
    return new Request(env().APP_URL, { headers: device ? { cookie: `${DEVICE_COOKIE}=${encodeURIComponent(device)}` } : {} });
}

export async function kidWatch(request: Request, showId: string): Promise<{ show: ShowView; token: LiveTokenResponse }> {
    const anon = anonymous(request);
    const access = await loadShowAccess(anon, showId);
    const snapshot = await buildSnapshot(access);
    const token = await issueJoinToken(anon, access);
    return { show: snapshot.show, token };
}
