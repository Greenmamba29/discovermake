/**
 * Account helpers for Server Components (pages). Pages get cookies from `next/headers`,
 * not a Request, so this builds a cookie-only Request and reuses the route helpers.
 * Read-only: pages cannot set cookies (route handlers do that).
 */
import 'server-only';
import { cookies } from 'next/headers';
import { env } from '../env';
import { loadBuildOwnership } from './build-access';
import { canEditBuild, getDeviceHash, getViewer, type ViewerContext } from './viewer';

export async function cookieRequest(): Promise<Request> {
    const store = await cookies();
    const cookie = store
        .getAll()
        .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
        .join('; ');
    return new Request(env().APP_URL, { headers: cookie ? { cookie } : {} });
}

export async function getPageViewer(): Promise<ViewerContext | null> {
    return getViewer(await cookieRequest());
}

/** null when the build does not exist. */
export async function canViewerEditBuild(buildId: string): Promise<boolean | null> {
    const build = await loadBuildOwnership(buildId);
    if (!build) return null;
    const request = await cookieRequest();
    return canEditBuild({ viewer: await getViewer(request), deviceHash: getDeviceHash(request) }, build);
}
