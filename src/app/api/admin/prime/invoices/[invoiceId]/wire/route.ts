/**
 * POST /api/admin/prime/invoices/:invoiceId/wire  AdminMarkWireRequest -> InvoiceView
 * Ops: a wire / ACH arrived outside the provider. Audited (who, bank reference, invoice.paid event);
 * the invoice's orders become PAID and production is authorized.
 */
import { AdminMarkWireRequest, type InvoiceView } from '@/contracts/prime';
import { requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { markWireReceived } from '@/server/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ invoiceId: string }>(async (request, { params }) => {
    const admin = await requireAdmin(request);
    const body = await parseJson(request, AdminMarkWireRequest);
    return json<InvoiceView>(await markWireReceived((await params).invoiceId, body.reference, admin.actor));
});
