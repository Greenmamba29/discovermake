/**
 * GET  /api/builds/:buildId/sourcing -> BuildSourcingView (public; ids are unguessable)
 *   "Finding manufacturing partners…" status + supplier offers as RouteOfferView
 *   (never the supplier's name or platform; totals computed server side in cents).
 * POST /api/builds/:buildId/sourcing  CreateSourcingRequest -> job summary
 *   (201 created, 200 when an open request for the same part/version/quantity exists).
 *   429 over 5 requests / minute / IP (in-memory placeholder, Retry-After header).
 */
import { BuildId } from '@/contracts/common';
import { CreateSourcingRequest } from '@/contracts/sourcing';
import { errorResponse, json, parseJson, route } from '@/server/http';
import { clientIp, FixedWindowRateLimiter } from '@/server/make-ai/rate-limit';
import { pathId } from '@/server/quote/route-helpers';
import { relayOutboxLazily } from '@/server/sourcing/auto-request';
import { getBuildSourcingView, requestBuyerSourcing } from '@/server/sourcing/buyer';
import { BUYER_SOURCING_RATE_LIMIT } from '@/server/sourcing/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = new FixedWindowRateLimiter(BUYER_SOURCING_RATE_LIMIT.limit, BUYER_SOURCING_RATE_LIMIT.windowMs);

export const GET = route<{ buildId: string }>(async (_request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    // Materialize auto-requests for fresh REVIEW quotes without waiting for the cron.
    await relayOutboxLazily();
    return json(await getBuildSourcingView(buildId));
});

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const decision = limiter.hit(clientIp(request));
    if (!decision.allowed) {
        const res = errorResponse('RATE_LIMITED', 'Too many sourcing requests. Wait a minute and try again.', 429);
        res.headers.set('retry-after', String(decision.retryAfterSeconds));
        return res;
    }
    const body = await parseJson(request, CreateSourcingRequest);
    const { job, created } = await requestBuyerSourcing(buildId, body);
    return json(job, { status: created ? 201 : 200 });
});
