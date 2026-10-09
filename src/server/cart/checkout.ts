/**
 * Multi-quote checkout: the build cart (several BINDING quotes) and the B2B invoice
 * checkout pay for N orders with ONE payment.
 *
 * Design (least invasive for the R1 order model, which is one quote per order):
 *   - one `orders` row per quote, priced exactly like single checkout
 *     (`priceOrderForCheckout`: snapshot validation + Prime benefits; the cart subtotal is
 *     the free-shipping qualifying amount);
 *   - one provider payment for the sum (Stripe Checkout Session, dev session, or invoice),
 *     recorded as a `cart_checkouts` payment group;
 *   - one `payments` row per order (`<group ref>#<n>`, amount = order total), so refunds,
 *     the ledger and every state machine stay per order.
 * All orders, payments and the group commit in one transaction with their events.
 */
import { eq, inArray } from 'drizzle-orm';
import { orderTypeForQuantity } from '../../contracts/checkout';
import type { Actor, Address } from '../../contracts/common';
import type { ShippingMethod } from '../../contracts/enums';
import { CartCheckoutResponse, type AppliedBenefit, type PaymentChoice } from '../../contracts/prime';
import { buildOrderUrl, createOrderAccessToken, hashOrderAccessToken } from '../auth/order-link';
import { getDb, withTx } from '../db';
import { cartCheckouts, invoices, orders, parts, payments, quotes, shops } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId, newOrderNumber } from '../ids';
import { dueDateFor, getInvoiceProvider, toInvoiceView } from '../invoices';
import { guestBuyerActor, priceOrderForCheckout, type CheckoutPricing } from '../orders/checkout';
import { SEALED_TOKEN_KEY, sealOrderToken } from '../orders/link-vault';
import { getPaymentProvider } from '../payments';
import type { BenefitResult, MembershipForBenefits } from '../prime/benefits';
import { recordOrderBenefits } from '../prime/order-benefits';
import { closeCart } from './cart';
import { groupConfirmationUrl, subRef } from './payment-group';
import { promisedShipDateFor } from '../orders/checkout';

export const MAX_CART_ITEMS = 20;

export type MultiCheckoutInput = {
    quoteIds: string[];
    cartId: string | null;
    userId: string | null;
    deviceHash: string | null;
    membership: MembershipForBenefits;
    shippingMethod: ShippingMethod;
    buyer: { email: string; name: string; phone?: string };
    shippingAddress: Address;
    notes?: string;
    payment: PaymentChoice;
};

type QuoteRow = typeof quotes.$inferSelect;

/** Price every quote (server snapshot + benefits). Shared by preview and checkout. */
export async function priceQuotes(quoteRows: QuoteRow[], shippingMethod: ShippingMethod, membership: MembershipForBenefits, now: Date = new Date()) {
    const qualifying = quoteRows.reduce((s, q) => s + q.subtotalCents, 0);
    const lines: { quote: QuoteRow; priced: BenefitResult<CheckoutPricing> }[] = [];
    for (const quote of quoteRows) lines.push({ quote, priced: await priceOrderForCheckout(quote, shippingMethod, membership, { qualifyingSubtotalCents: qualifying, now }) });
    return lines;
}

export function sumTotals(list: CheckoutPricing[], currency = 'usd') {
    return {
        subtotalCents: list.reduce((s, t) => s + t.subtotalCents, 0),
        shippingCents: list.reduce((s, t) => s + t.shippingCents, 0),
        taxCents: list.reduce((s, t) => s + t.taxCents, 0),
        totalCents: list.reduce((s, t) => s + t.totalCents, 0),
        currency: list[0]?.currency ?? currency,
    };
}

export function mergeBenefits(list: AppliedBenefit[][]): AppliedBenefit[] {
    const byCode = new Map<string, AppliedBenefit>();
    for (const b of list.flat()) {
        const prev = byCode.get(b.code);
        byCode.set(b.code, prev ? { ...prev, savingsCents: prev.savingsCents + b.savingsCents } : { ...b });
    }
    return [...byCode.values()];
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
    const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (e?.code === '23505' && (e.constraint_name === constraint || e.constraint === constraint)) return true;
    return e?.cause ? isUniqueViolation(e.cause, constraint) : false;
}

export async function checkoutQuotes(input: MultiCheckoutInput): Promise<CartCheckoutResponse> {
    const ids = [...new Set(input.quoteIds)];
    if (!ids.length) throw new ApiError('CONFLICT', 'Your cart is empty.');
    if (ids.length > MAX_CART_ITEMS) throw new ApiError('VALIDATION_FAILED', `A cart can hold up to ${MAX_CART_ITEMS} parts.`);
    if (input.payment.mode === 'invoice' && !input.shippingAddress.company?.trim()) {
        throw new ApiError('VALIDATION_FAILED', 'Pay by invoice is for business buyers: enter your company name.');
    }
    const db = getDb();
    const rows = await db.select().from(quotes).where(inArray(quotes.id, ids));
    if (rows.length !== ids.length) throw new ApiError('NOT_FOUND', 'A quote in your cart no longer exists.');
    const quoteRows = ids.map((id) => rows.find((r) => r.id === id)!);
    const lines = await priceQuotes(quoteRows, input.shippingMethod, input.membership);
    const shopRows = await db.select({ id: shops.id, timezone: shops.timezone }).from(shops).where(inArray(shops.id, [...new Set(quoteRows.map((q) => q.shopId))]));
    const tz = new Map(shopRows.map((s) => [s.id, s.timezone]));
    for (const q of quoteRows) if (!tz.has(q.shopId)) throw new ApiError('CONFLICT', 'A quoted shop is no longer available. Get a new quote.');

    const totals = sumTotals(lines.map((l) => l.priced.totals));
    const benefits = mergeBenefits(lines.map((l) => l.priced.benefits));
    const actor: Actor = input.userId ? { kind: 'buyer', id: input.userId } : guestBuyerActor(input.buyer.email);
    const appUrl = env().APP_URL;
    const mode = input.payment.mode;

    for (let attempt = 0; attempt < 3; attempt++) {
        const now = new Date();
        const checkoutId = newId('cartCheckout');
        const groupToken = createOrderAccessToken();
        const confirmationUrl = groupConfirmationUrl(checkoutId, groupToken);
        const prepared = lines.map(({ quote, priced }) => {
            const orderId = newId('order');
            const token = createOrderAccessToken();
            return { quote, priced, orderId, orderNumber: newOrderNumber(), token, orderUrl: buildOrderUrl(orderId, token, appUrl), promisedShipDate: promisedShipDateFor(quote, tz.get(quote.shopId)!, now) };
        });
        try {
            return await withTx(async (tx) => {
                for (const p of prepared) {
                    const { quote } = p;
                    const pricing = p.priced.totals;
                    const [locked] = await tx.select({ designVersion: parts.designVersion, status: parts.status }).from(parts).where(eq(parts.id, quote.partId)).for('update');
                    if (!locked || locked.status !== 'READY' || locked.designVersion !== quote.designVersion) {
                        throw new ApiError('CONFLICT', `${quote.summary.partFilename} changed after it was quoted. Get a new quote for it.`);
                    }
                    const orderType = orderTypeForQuantity(pricing.quantity);
                    await tx.insert(orders).values({
                        id: p.orderId,
                        orderNumber: p.orderNumber,
                        buildId: quote.buildId,
                        quoteId: quote.id,
                        orderType,
                        status: 'PENDING_PAYMENT',
                        buyerUserId: input.userId,
                        buyerEmail: input.buyer.email,
                        buyerName: input.buyer.name,
                        buyerPhone: input.buyer.phone ?? null,
                        shippingAddress: input.shippingAddress,
                        shippingMethod: input.shippingMethod,
                        notes: input.notes ?? null,
                        quantity: pricing.quantity,
                        unitPriceCents: pricing.unitPriceCents,
                        subtotalCents: pricing.subtotalCents,
                        shippingCents: pricing.shippingCents,
                        taxCents: pricing.taxCents,
                        totalCents: pricing.totalCents,
                        shopCostCents: pricing.shopCostCents,
                        platformFeeCents: pricing.platformFeeCents,
                        currency: pricing.currency,
                        promisedShipDate: p.promisedShipDate,
                        accessTokenHash: hashOrderAccessToken(p.orderId, p.token),
                        correlationId: quote.buildId,
                        termsAcceptedAt: now,
                        createdAt: now,
                        updatedAt: now,
                    });
                    await emitEvent(tx, {
                        type: 'order.created',
                        payload: { orderId: p.orderId, orderNumber: p.orderNumber, quoteId: quote.id, orderType, totalCents: pricing.totalCents, currency: pricing.currency },
                        actor,
                        correlationId: quote.buildId,
                        buildId: quote.buildId,
                        orderId: p.orderId,
                        timestamp: now,
                    });
                    await recordOrderBenefits(tx, p.orderId, p.priced, input.userId);
                }

                const orderNumbers = prepared.map((p) => p.orderNumber).join(', ');
                const description = `${prepared.length} part${prepared.length === 1 ? '' : 's'} · ${orderNumbers}`;
                let providerName: 'stripe' | 'dev';
                let providerRef: string;
                let redirectUrl: string;
                let invoiceRow: typeof invoices.$inferSelect | null = null;
                try {
                    if (input.payment.mode === 'card') {
                        const provider = getPaymentProvider();
                        const validUntil = new Date(Math.min(...prepared.map((p) => p.quote.validUntil.getTime())));
                        const session = await provider.createPayment({
                            orderId: checkoutId,
                            orderNumber: `CART-${prepared.length}`,
                            amountCents: totals.totalCents,
                            currency: totals.currency,
                            buyerEmail: input.buyer.email,
                            description,
                            successUrl: confirmationUrl,
                            cancelUrl: new URL('/cart?cancelled=1', appUrl).toString(),
                            metadata: { dm_cart_checkout_id: checkoutId, dm_app: new URL(appUrl).host },
                            expiresAt: validUntil,
                        });
                        providerName = provider.name;
                        providerRef = session.providerRef;
                        redirectUrl = session.redirectUrl;
                    } else {
                        const invoiceProvider = getInvoiceProvider();
                        const invoiceId = newId('invoice');
                        const created = await invoiceProvider.create({
                            invoiceId,
                            checkoutId,
                            email: input.buyer.email,
                            name: input.buyer.name,
                            company: input.shippingAddress.company!.trim(),
                            amountCents: totals.totalCents,
                            currency: totals.currency,
                            netDays: input.payment.netDays,
                            poNumber: input.payment.poNumber,
                            lines: prepared.map((p) => ({ description: `${p.orderNumber} · ${p.quote.summary.quantity} × ${p.quote.summary.partFilename}`, amountCents: p.priced.totals.totalCents })),
                        });
                        providerName = invoiceProvider.name;
                        providerRef = created.providerInvoiceId;
                        redirectUrl = confirmationUrl;
                        invoiceRow = {
                            id: invoiceId,
                            checkoutId,
                            provider: invoiceProvider.name,
                            providerInvoiceId: created.providerInvoiceId,
                            status: 'open',
                            amountCents: totals.totalCents,
                            currency: totals.currency,
                            netDays: input.payment.netDays,
                            dueDate: dueDateFor(input.payment.netDays, now),
                            hostedUrl: created.hostedUrl,
                            buyerEmail: input.buyer.email,
                            company: input.shippingAddress.company!.trim(),
                            poNumber: input.payment.poNumber ?? null,
                            paidAt: null,
                            markedPaidBy: null,
                            paidReference: null,
                            createdAt: now,
                            updatedAt: now,
                        };
                    }
                } catch (err) {
                    if (err instanceof ApiError) throw err;
                    console.error('[cart-checkout] payment provider error', err);
                    throw new ApiError('PAYMENT_ERROR', 'We could not start the payment. Please try again in a moment.');
                }

                await tx.insert(cartCheckouts).values({
                    id: checkoutId,
                    cartId: input.cartId,
                    userId: input.userId,
                    deviceHash: input.deviceHash,
                    provider: providerName,
                    providerRef,
                    mode,
                    orderIds: prepared.map((p) => p.orderId),
                    amountCents: totals.totalCents,
                    currency: totals.currency,
                    status: 'PENDING',
                    accessTokenHash: hashOrderAccessToken(checkoutId, groupToken),
                    sealedToken: sealOrderToken(checkoutId, groupToken),
                    createdAt: now,
                    updatedAt: now,
                });
                for (const [i, p] of prepared.entries()) {
                    await tx.insert(payments).values({
                        orderId: p.orderId,
                        provider: providerName,
                        providerRef: subRef(providerRef, i),
                        amountCents: p.priced.totals.totalCents,
                        currency: p.priced.totals.currency,
                        status: 'PENDING',
                        metadata: { [SEALED_TOKEN_KEY]: sealOrderToken(p.orderId, p.token), cartCheckoutId: checkoutId, groupRef: providerRef },
                        createdAt: now,
                        updatedAt: now,
                    });
                }
                if (invoiceRow) {
                    await tx.insert(invoices).values(invoiceRow);
                    await emitEvent(tx, {
                        type: 'invoice.created',
                        payload: { invoiceId: invoiceRow.id, checkoutId, orderIds: prepared.map((p) => p.orderId), amountCents: invoiceRow.amountCents, netDays: invoiceRow.netDays, dueDate: invoiceRow.dueDate },
                        actor,
                        correlationId: checkoutId,
                    });
                }
                await emitEvent(tx, {
                    type: 'cart.checked_out',
                    payload: { checkoutId, orderIds: prepared.map((p) => p.orderId), totalCents: totals.totalCents, currency: totals.currency, mode },
                    actor,
                    correlationId: checkoutId,
                });
                if (input.cartId) await closeCart(input.cartId, tx);

                return CartCheckoutResponse.parse({
                    checkoutId,
                    orders: prepared.map((p) => ({ orderId: p.orderId, orderNumber: p.orderNumber, orderUrl: p.orderUrl, totals: { ...sumTotals([p.priced.totals]) } })),
                    totals,
                    benefits,
                    payment: { provider: providerName, providerRef, redirectUrl },
                    invoice: invoiceRow ? await toInvoiceView(invoiceRow, tx) : null,
                    confirmationUrl,
                } satisfies CartCheckoutResponse);
            });
        } catch (err) {
            if (isUniqueViolation(err, 'orders_order_number_uq') && attempt < 2) continue;
            throw err;
        }
    }
    throw new ApiError('INTERNAL', 'Could not allocate order numbers');
}
