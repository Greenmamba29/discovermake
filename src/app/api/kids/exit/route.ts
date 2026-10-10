/**
 * POST /api/kids/exit  ExitKidsModeRequest -> { url: '/family' } and the Kids mode cookie cleared.
 * Needs the grown-up PIN of the family that started Kids mode; attempts are rate limited per
 * grown-up (5 per 15 minutes). 403 on a wrong PIN, 429 when locked out.
 */
import { NextResponse } from 'next/server';
import { ExitKidsModeRequest } from '@/contracts/kids';
import { assertSameOrigin } from '@/server/auth/viewer';
import { ApiError, parseJson, route } from '@/server/http';
import { clearKidCookie, exitKidsMode, kidModeState } from '@/server/kids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const { pin } = await parseJson(request, ExitKidsModeRequest);
    const state = await kidModeState(request);
    const who =
        state.kind === 'active'
            ? { ownerUserId: state.session.ownerUserId, sessionId: state.session.sessionId, kidId: state.session.kid.id }
            : state.kind === 'ended'
              ? { ownerUserId: state.ownerUserId, sessionId: state.sessionId, kidId: state.claims?.k ?? null }
              : { ownerUserId: null, sessionId: null, kidId: null };
    const result = await exitKidsMode(who, pin);
    if (!result.ok && result.reason === 'rate_limited') throw new ApiError('RATE_LIMITED', 'Too many tries. Wait a few minutes, then try again.', 429, { retryAfterSeconds: result.retryAfterSeconds });
    if (!result.ok) throw new ApiError('FORBIDDEN', 'That PIN is not right. Ask your grown-up.', 403);
    const response = NextResponse.json({ url: '/family' }, { headers: { 'cache-control': 'no-store' } });
    clearKidCookie(response);
    return response;
});
