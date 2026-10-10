/**
 * POST /api/builds/:buildId/sourcing/offers/:offerId/quote -> QuoteView (BINDING, routeKind 'supplier')
 * "Get your binding price" on a supplier route ops confirmed (offer SELECTED via an APPROVED
 * SELECT_SUPPLIER_OFFER). 201 when a quote was made, 200 when a still-valid one is returned.
 * 409 when the route is not confirmed, the offer expired, or the design moved on.
 */
import { BuildId, SupplierOfferId } from '@/contracts/common';
import { json, route } from '@/server/http';
import { createSupplierBindingQuote } from '@/server/prime/quotes';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string; offerId: string }>(async (_request, { params }) => {
    const p = await params;
    const buildId = pathId(p.buildId, BuildId, 'Build');
    const offerId = pathId(p.offerId, SupplierOfferId, 'Offer');
    const { quote, created } = await createSupplierBindingQuote(buildId, offerId);
    return json(quote, { status: created ? 201 : 200 });
});
