/** GET /api/kids/things -> KidThingsView: the kid's own requests with the stage of the grown-up's real order. */
import type { KidThingsView } from '@/contracts/kids';
import { json, route } from '@/server/http';
import { listKidThings, requireKidSession } from '@/server/kids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const kid = await requireKidSession(request);
    return json<KidThingsView>({ items: await listKidThings(kid) });
});
