/**
 * GET /api/me/cart/checkouts/:checkoutId?t=<token> -> the orders of one cart checkout
 * (signed confirmation link; 404 on a wrong token).
 */
import { z } from 'zod';
import { InvoiceView } from '@/contracts/prime';
import { readOrderToken } from '@/server/auth/order-link';
import { findGroupById, groupOrders, verifyGroupToken } from '@/server/cart/payment-group';
import { getDb } from '@/server/db';
import { invoices } from '@/server/db/schema';
import { ApiError, json, route } from '@/server/http';
import { toInvoiceView } from '@/server/invoices';
import { eq } from 'drizzle-orm';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GroupResponse = z.object({
    checkoutId: z.string(),
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
    mode: z.enum(['card', 'invoice']),
    totalCents: z.number().int(),
    currency: z.string(),
    orders: z.array(z.object({ orderId: z.string(), orderNumber: z.string(), status: z.string(), totalCents: z.number().int(), currency: z.string(), orderUrl: z.string().nullable() })),
    invoice: InvoiceView.nullable(),
});

export const GET = route<{ checkoutId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    const group = await findGroupById((await params).checkoutId);
    if (!group || !verifyGroupToken(group, readOrderToken(request))) throw new ApiError('NOT_FOUND', 'Checkout not found');
    const [inv] = await getDb().select().from(invoices).where(eq(invoices.checkoutId, group.id)).limit(1);
    return json({
        checkoutId: group.id,
        status: group.status,
        mode: group.mode,
        totalCents: group.amountCents,
        currency: group.currency,
        orders: await groupOrders(group),
        invoice: inv ? await toInvoiceView(inv) : null,
    } satisfies z.infer<typeof GroupResponse>);
});
