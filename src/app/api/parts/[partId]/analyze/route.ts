/**
 * POST /api/parts/:partId/analyze  AnalyzePartRequest -> PartView (build owner / its device; 403 otherwise, ADR-0009).
 *
 * Body is optional. Send `{ "units": "mm" | "in" }` after a NEEDS_INPUT result to
 * resolve ambiguous units. Unsupported/unreadable files come back as status FAILED
 * with a buyer-facing `error` (200), not as an HTTP error.
 */
import { AnalyzePartRequest, PartId } from '@/contracts';
import { assertCanEditPart } from '@/server/auth/build-access';
import { json, route } from '@/server/http';
import { analyzePart } from '@/server/quote';
import { pathId, readJsonBody, validate } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Large DXFs can take a few seconds to parse. */
export const maxDuration = 60;

export const POST = route<{ partId: string }>(async (request, { params }) => {
    const partId = pathId((await params).partId, PartId, 'Part');
    await assertCanEditPart(request, partId);
    const body = validate(await readJsonBody(request, { allowEmpty: true }), AnalyzePartRequest);
    return json(await analyzePart(partId, body));
});
