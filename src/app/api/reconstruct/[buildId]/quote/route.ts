/**
 * POST /api/reconstruct/:buildId/quote  ReconstructQuoteRequest -> QuoteView (201)
 *
 * Print quote for the latest generated CAD version: the print quote engine prices the STL from
 * the worker manifest (volume, area, bbox) on every capable partner and persists the usual
 * immutable quote (BINDING when a partner printer fits and print DFM passes). Checkout is
 * /checkout/:quoteId, unchanged.
 */
import { ReconstructQuoteRequest } from '@/contracts/reconstruct';
import { limitWrite } from '@/server/build-graph';
import { json, parseJson, route } from '@/server/http';
import { reconstructBuildId, reconstructGenerateLimiter, requireOwnedReconstruct } from '@/server/reconstruct/request';
import { quoteReconstruct } from '@/server/reconstruct/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = reconstructBuildId((await params).buildId);
    const limited = await limitWrite(request, reconstructGenerateLimiter, 'Too many quotes in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const body = await parseJson(request, ReconstructQuoteRequest, 4 * 1024);
    await requireOwnedReconstruct(request, buildId);
    return json(await quoteReconstruct(buildId, body), { status: 201 });
});
