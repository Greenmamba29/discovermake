/** GET /api/kids/me -> KidHomeView (live kid session only): nickname, avatar, the projects the grown-up allowed. */
import type { KidHomeView } from '@/contracts/kids';
import { json, route } from '@/server/http';
import { kidHomeView, requireKidSession } from '@/server/kids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const kid = await requireKidSession(request);
    return json<KidHomeView>(kidHomeView(kid));
});
