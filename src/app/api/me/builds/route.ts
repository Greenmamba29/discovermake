/**
 * GET /api/me/builds?tab=all&limit=50 -> MyBuildsResponse
 * Signed in: the user's builds (incl. claimed guest builds and builds behind their orders).
 * Guest: this device's builds (`guest: true`, prompt to sign in to keep them).
 */
import { z } from 'zod';
import { MyBuildsTab, type MyBuildsResponse } from '@/contracts/account';
import { listMyBuilds } from '@/server/accounts/my-builds';
import { applySessionRefresh, getDeviceHash, getViewer } from '@/server/auth/viewer';
import { json, parseQuery, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
    tab: MyBuildsTab.default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route(async (request) => {
    const q = parseQuery(request, Query);
    const viewer = await getViewer(request);
    // Read-only: never mints a device (see GET /api/me).
    const res = json<MyBuildsResponse>(await listMyBuilds({ viewer, deviceHash: getDeviceHash(request) }, q.tab, q.limit));
    await applySessionRefresh(request, res);
    return res;
});
