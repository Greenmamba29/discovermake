/**
 * POST /api/admin/supplier-legs/:legId/advance  AdvanceSupplierLegRequest -> SupplierLegOpsView
 * Ops records supplier-side news on a supplier fulfilment leg: production started (needs the
 * supplier deposit approved), shipped inbound (tracking; creates the partner's receiving job),
 * delivered (direct ship only). 409 on an illegal transition. Auth: Bearer ADMIN_TOKEN.
 */
import { AdvanceSupplierLegRequest, SupplierLegId } from '@/contracts/promise';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { advanceSupplierLeg } from '@/server/prime/fulfilment';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ legId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const legId = pathId((await params).legId, SupplierLegId, 'Supplier leg');
    const body = await parseJson(request, AdvanceSupplierLegRequest);
    return json(await advanceSupplierLeg(legId, body, { ...ADMIN_ACTOR }));
});
