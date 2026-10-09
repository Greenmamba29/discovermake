/**
 * POST /api/admin/prime/invoices/:invoiceId/dev  DevInvoiceSimulateRequest -> InvoiceView
 * Dev invoice double only (PAYMENT_PROVIDER=dev, never in production): simulate paid / overdue.
 */
import { DevInvoiceSimulateRequest, type InvoiceView } from '@/contracts/prime';
import { requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { getInvoice, markInvoiceOverdue, settleInvoice, toInvoiceView } from '@/server/invoices';
import { isDevPaymentEnabled } from '@/server/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ invoiceId: string }>(async (request, { params }) => {
    if (!isDevPaymentEnabled()) throw new ApiError('NOT_FOUND', 'Not found');
    await requireAdmin(request);
    const body = await parseJson(request, DevInvoiceSimulateRequest);
    const row = await getInvoice((await params).invoiceId);
    if (!row || row.provider !== 'dev') throw new ApiError('NOT_FOUND', 'Invoice not found');
    const actor = { kind: 'payment_provider' as const, id: 'dev' };
    const updated =
        body.outcome === 'paid'
            ? await settleInvoice(row, { eventId: `dev:${row.providerInvoiceId}:paid`, method: 'provider', amountCents: row.amountCents, currency: row.currency, actor })
            : await markInvoiceOverdue(row, actor);
    return json<InvoiceView>(await toInvoiceView(updated));
});
