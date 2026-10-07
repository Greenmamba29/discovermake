/**
 * POST /api/builds/:buildId/sourcing/offers/:offerId/select -> RouteOfferView (with `selection`)
 * "Choose this route": creates (or returns the existing) PENDING SELECT_SUPPLIER_OFFER
 * approval for ops to confirm (201 created, 200 existing). Only ACTIVE offers with trust
 * SUPPLIER_CONFIRMED on the build's current design version are selectable (409 otherwise).
 * R2 does not turn a selected offer into a checkout: checkout stays BINDING-only.
 */
import { BuildId, SupplierOfferId } from '@/contracts/common';
import { json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { selectRouteOffer } from '@/server/sourcing/buyer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string; offerId: string }>(async (_request, { params }) => {
    const p = await params;
    const buildId = pathId(p.buildId, BuildId, 'Build');
    const offerId = pathId(p.offerId, SupplierOfferId, 'Offer');
    const { offer, created } = await selectRouteOffer(buildId, offerId);
    return json(offer, { status: created ? 201 : 200 });
});
