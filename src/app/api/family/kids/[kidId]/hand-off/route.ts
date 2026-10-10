/**
 * POST /api/family/kids/:kidId/hand-off -> { url: '/kids' } + the signed `dm_kid` cookie.
 * "Hand to <kid>" on the grown-up's own signed-in device: locks this session to Kids mode until
 * the grown-up exits with their PIN (which must be set first).
 */
import { NextResponse } from 'next/server';
import { KidProfileId } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { route } from '@/server/http';
import { handOffToKid, requireGrownUp, setKidCookie } from '@/server/kids';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ kidId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const viewer = await requireGrownUp(request);
    const kidId = pathId((await params).kidId, KidProfileId, 'Kid profile');
    const { cookie, url } = await handOffToKid({ userId: viewer.user.id, sessionId: viewer.sessionId }, kidId);
    const response = NextResponse.json({ url }, { headers: { 'cache-control': 'no-store' } });
    setKidCookie(response, cookie);
    return response;
});
