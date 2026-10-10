/**
 * PUT /api/admin/kids/kid-safe/:buildId  { kidSafe: boolean } -> { buildId, kidSafe }
 * Ops review: only builds marked kid-safe appear in Kids mode Discover (when a grown-up allows it).
 */
import { z } from 'zod';
import { BuildId } from '@/contracts/common';
import { requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { setKidSafe } from '@/server/kids';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = route<{ buildId: string }>(async (request, { params }) => {
    const admin = await requireAdmin(request);
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const { kidSafe } = await parseJson(request, z.object({ kidSafe: z.boolean() }).strict());
    return json(await setKidSafe(buildId, kidSafe, `${admin.actor.kind}:${admin.actor.id}`));
});
