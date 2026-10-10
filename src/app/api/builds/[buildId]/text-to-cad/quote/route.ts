/**
 * POST /api/builds/:buildId/text-to-cad/quote  MakeIt3dQuoteRequest -> QuoteView (201)
 *
 * BINDING 3D-print quote for a "Make it in 3D" model, once the buyer APPROVED the design version
 * that carries it (409 for a draft). The STL (sha256-checked) becomes a READY printed part and the
 * print engine (createPrintQuote) prices the worker's measured geometry on every capable partner.
 * Checkout is /checkout/:quoteId, unchanged. Owner-only; per-IP rate limited.
 */
import { BuildId } from '@/contracts';
import { MakeIt3dQuoteRequest } from '@/contracts/make-it-3d';
import { limitWrite } from '@/server/build-graph';
import { assertCanEditBuild } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { quoteMakeIt3d } from '@/server/text-to-cad/service';
import { requireBuild } from '@/server/workspace/attachments';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const limited = await limitWrite(request, undefined, 'Too many quotes in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const body = await parseJson(request, MakeIt3dQuoteRequest, 4 * 1024);
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    return json(await quoteMakeIt3d(buildId, body), { status: 201 });
});
