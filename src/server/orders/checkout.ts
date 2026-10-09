/**
 * Server-priced checkout (workflow 04 · screen 04, ADR-0004).
 *
 * The request carries ids + buyer details only. Every amount comes from the
 * immutable quote snapshot: subtotal (= sum of line items), the shop/platform
 * split, and the chosen shipping option's price. Tax is 0 in R1.
 */
import { eq } from 'drizzle-orm';
import { CheckoutResponse, orderTypeForQuantity, type CheckoutRequest } from '../../contracts/checkout';
import type { Actor } from '../../contracts/common';
import { buildOrderUrl, createOrderAccessToken, hashOrderAccessToken } from '../auth/order-link';
import { sha256Hex } from '../auth/tokens';
import { getDb, withTx } from '../db';
import { builds, orders, parts, payments, quotes, shopRateCards, shops } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId, newOrderNumber } from '../ids';
import { getPaymentProvider } from '../payments';
import { isQuoteOrderable } from '../quote';
import { addBusinessDays, orderStartDate } from '../quote/leadtime';
import { SEALED_TOKEN_KEY, sealOrderToken } from './link-vault';
import { createPaymentPlan, PAYMENT_PURPOSE_KEY } from '../prime/payments';
import { setOrderPromise } from '../promise/engine';

type QuoteRow = typeof quotes.$inferSelect;

export type CheckoutPricing = {
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    shopCostCents: number;
    platformFeeCents: number;
    currency: string;
};

/**
 * Validate that a quote may be ordered right now and price the order from its
 * snapshot. Throws ApiError(CONFLICT) with a buyer-readable reason otherwise.
 */
export async function priceQuoteForCheckout(quote: QuoteRow, shippingMethod: CheckoutRequest['shippingMethod'], now: Date = new Date()): Promise<CheckoutPricing> {
    if (quote.status === 'ORDERED') throw new ApiError('CONFLICT', 'This quote has already been ordered. Configure the part again for a new quote.');
    if (quote.status === 'EXPIRED' || quote.validUntil.getTime() <= now.getTime()) {
        throw new ApiError('CONFLICT', 'This quote has expired. Refresh the quote to get current pricing.');
    }
    if (quote.status !== 'READY') throw new ApiError('CONFLICT', `This quote is not orderable (status ${quote.status}).`);
    if (quote.trustLevel !== 'BINDING') throw new ApiError('CONFLICT', 'Only binding quotes can be ordered. This quote needs shop confirmation first.');
    if (quote.dfm?.blocking) throw new ApiError('CONFLICT', 'This part has blocking manufacturability issues. Fix them and re-quote.');

    // Staleness: the design or the pricing inputs changed after the quote was made.
    const db = getDb();
    const [part] = await db.select().from(parts).where(eq(parts.id, quote.partId));
    if (!part || part.status !== 'READY' || part.designVersion !== quote.designVersion) {
        throw new ApiError('CONFLICT', 'The design changed after this quote was made. Get a new quote for the current version.');
    }
    if (part.rulesetVersion !== quote.rulesetVersion) {
        throw new ApiError('CONFLICT', 'Our manufacturability rules were updated after this quote was made. Get a new quote.');
    }
    // Same predicate the quote module uses for QuoteView.orderable, so checkout and the UI never disagree.
    if (!isQuoteOrderable(quote, { designVersion: part.designVersion, rulesetVersion: part.rulesetVersion }, now)) {
        throw new ApiError('CONFLICT', 'This quote is no longer orderable. Get a new quote.');
    }
    const [rateCard] = await db.select().from(shopRateCards).where(eq(shopRateCards.id, quote.rateCardId));
    if (!rateCard || !rateCard.active) {
        throw new ApiError('CONFLICT', 'Pricing changed after this quote was made. Get a new quote.');
    }

    // Snapshot integrity: never trust a snapshot that does not add up.
    const lineSum = quote.lineItems.reduce((s, li) => s + li.totalCents, 0);
    if (lineSum !== quote.subtotalCents || quote.shopCostCents + quote.platformFeeCents !== quote.subtotalCents || quote.config.quantity !== quote.quantity) {
        throw new ApiError('CONFLICT', 'This quote could not be verified. Get a new quote.');
    }

    const shipping = quote.shippingOptions.find((o) => o.method === shippingMethod);
    if (!shipping) throw new ApiError('VALIDATION_FAILED', `Shipping method ${shippingMethod} is not available for this quote.`);

    const taxCents = 0; // R1: no tax collection (Stripe Tax in R2; owner decision pending).
    return {
        quantity: quote.quantity,
        unitPriceCents: quote.unitPriceCents,
        subtotalCents: quote.subtotalCents,
        shippingCents: shipping.priceCents,
        taxCents,
        totalCents: quote.subtotalCents + shipping.priceCents + taxCents,
        shopCostCents: quote.shopCostCents,
        platformFeeCents: quote.platformFeeCents,
        currency: quote.currency,
    };
}

/**
 * Ship date promised at checkout. Quotes stay binding for QUOTE_VALIDITY_DAYS, but
 * their ship date was computed when the quote was made; the quoted lead time is
 * re-applied from the moment of ordering (shop timezone, same-day cutoff, business
 * days) so an order never starts with a ship date that already passed. Never earlier
 * than the quoted date.
 */
export function promisedShipDateFor(quote: Pick<QuoteRow, 'shipDate' | 'leadTimeDays'>, timeZone: string, now: Date = new Date()): string {
    const rolled = addBusinessDays(orderStartDate(now, timeZone), Math.max(1, quote.leadTimeDays));
    return rolled > quote.shipDate ? rolled : quote.shipDate;
}

/** Pseudonymous, stable actor for a guest buyer (no raw email in the event log). */
export function guestBuyerActor(email: string): Actor {
    return { kind: 'buyer', id: `guest_${sha256Hex(email.trim().toLowerCase()).slice(0, 24)}` };
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
    const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (e?.code === '23505' && (e.constraint_name === constraint || e.constraint === constraint)) return true;
    return e?.cause ? isUniqueViolation(e.cause, constraint) : false;
}

export async function createCheckout(input: CheckoutRequest): Promise<CheckoutResponse> {
    const db = getDb();
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
    if (!quote) throw new ApiError('NOT_FOUND', 'Quote not found');
    const pricing = await priceQuoteForCheckout(quote, input.shippingMethod);
    const [build] = await db.select().from(builds).where(eq(builds.id, quote.buildId));
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    const [shop] = await db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, quote.shopId));
    if (!shop) throw new ApiError('CONFLICT', 'The quoted shop is no longer available. Get a new quote.');

    const orderType = orderTypeForQuantity(pricing.quantity);
    const actor = guestBuyerActor(input.buyer.email);
    const provider = getPaymentProvider();
    const appUrl = env().APP_URL;

    for (let attempt = 0; attempt < 3; attempt++) {
        const orderId = newId('order');
        const orderNumber = newOrderNumber();
        const token = createOrderAccessToken();
        const orderUrl = buildOrderUrl(orderId, token, appUrl);
        const now = new Date();
        const promisedShipDate = promisedShipDateFor(quote, shop.timezone, now);
        try {
            return await withTx(async (tx) => {
                // Freeze the design from checkout on: lock the part row and re-verify the quoted
                // version under the lock. analyzePart takes the same lock and refuses to change a
                // part that has a live order, so the shop always gets the geometry that was paid for.
                const [lockedPart] = await tx.select({ designVersion: parts.designVersion, status: parts.status }).from(parts).where(eq(parts.id, quote.partId)).for('update');
                if (!lockedPart || lockedPart.status !== 'READY' || lockedPart.designVersion !== quote.designVersion) {
                    throw new ApiError('CONFLICT', 'The design changed after this quote was made. Get a new quote for the current version.');
                }
                await tx.insert(orders).values({
                    id: orderId,
                    orderNumber,
                    buildId: quote.buildId,
                    quoteId: quote.id,
                    orderType,
                    status: 'PENDING_PAYMENT',
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
                    promisedShipDate,
                    accessTokenHash: hashOrderAccessToken(orderId, token),
                    correlationId: quote.buildId,
                    termsAcceptedAt: now,
                    createdAt: now,
                    updatedAt: now,
                });
                await emitEvent(tx, {
                    type: 'order.created',
                    payload: { orderId, orderNumber, quoteId: quote.id, orderType, totalCents: pricing.totalCents, currency: pricing.currency },
                    actor,
                    correlationId: quote.buildId,
                    buildId: quote.buildId,
                    orderId,
                    timestamp: now,
                });

                // R3: the first charge (full, or the supplier-route deposit) minus any promise credit,
                // and the Delivery Promise with its per-leg P90s.
                const charge = await createPaymentPlan(tx, { orderId, totalCents: pricing.totalCents, buyerEmail: input.buyer.email, quoteId: quote.id, now });
                await setOrderPromise(tx, { order: { id: orderId, correlationId: quote.buildId, buildId: quote.buildId, promisedShipDate }, quote, method: input.shippingMethod, shipToRegion: input.shippingAddress.region, now });

                // Provider session inside the transaction: if it fails, no order is left behind.
                // (A provider session orphaned by a failed commit simply expires unpaid.)
                let session;
                try {
                    session = await provider.createPayment({
                        orderId,
                        orderNumber,
                        amountCents: charge.chargeCents,
                        currency: pricing.currency,
                        buyerEmail: input.buyer.email,
                        description: `${orderNumber} · ${pricing.quantity} x ${quote.summary.partFilename} (${quote.summary.materialName} ${quote.summary.thicknessLabel})${charge.purpose === 'deposit' ? ' · deposit' : ''}`,
                        successUrl: orderUrl,
                        cancelUrl: new URL(`/build/${encodeURIComponent(quote.buildId)}/approve?quote=${encodeURIComponent(quote.id)}&cancelled=1`, appUrl).toString(),
                        metadata: { dm_quote_id: quote.id, dm_build_id: quote.buildId, dm_app: new URL(appUrl).host },
                        expiresAt: quote.validUntil,
                    });
                } catch (err) {
                    console.error('[checkout] payment provider error', err);
                    throw new ApiError('PAYMENT_ERROR', 'We could not start the payment. Please try again in a moment.');
                }

                await tx.insert(payments).values({
                    orderId,
                    provider: provider.name,
                    providerRef: session.providerRef,
                    amountCents: charge.chargeCents,
                    currency: pricing.currency,
                    status: 'PENDING',
                    metadata: { [SEALED_TOKEN_KEY]: sealOrderToken(orderId, token), [PAYMENT_PURPOSE_KEY]: charge.purpose },
                    createdAt: now,
                    updatedAt: now,
                });

                return CheckoutResponse.parse({
                    orderId,
                    orderNumber,
                    status: 'PENDING_PAYMENT',
                    orderType,
                    totals: {
                        subtotalCents: pricing.subtotalCents,
                        shippingCents: pricing.shippingCents,
                        taxCents: pricing.taxCents,
                        totalCents: pricing.totalCents,
                        currency: pricing.currency,
                    },
                    promisedShipDate,
                    payment: { provider: provider.name, providerRef: session.providerRef, redirectUrl: session.redirectUrl, amountCents: charge.chargeCents, purpose: charge.purpose },
                    orderUrl,
                    ...(charge.creditCents > 0 ? { creditAppliedCents: charge.creditCents } : {}),
                    ...(charge.purpose === 'deposit' ? { balanceDueCents: charge.balanceCents } : {}),
                } satisfies CheckoutResponse);
            });
        } catch (err) {
            if (isUniqueViolation(err, 'orders_order_number_uq') && attempt < 2) continue;
            throw err;
        }
    }
    throw new ApiError('INTERNAL', 'Could not allocate an order number');
}
