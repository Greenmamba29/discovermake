/**
 * Live Drops and Build Slots (workflow 06 "Build Slots: selling capacity, not inventory").
 *
 * Money flow (real, through the orders + payments modules):
 *   start_drop  the creator's price must cover an orderable BINDING quote for the build at
 *               quantity = thresholdSlots (creators cannot sell below cost).
 *   claim       fair queue: the drop row is locked (SELECT ... FOR UPDATE), so claims are
 *               serialized and never exceed totalSlots or perBuyerLimit. Each claim creates a
 *               BUILD_SLOT order (PENDING_PAYMENT) and an authorize-only payment session
 *               (Stripe PaymentIntent capture_method=manual; the dev provider simulates it).
 *               Slots are held for CLAIM_HOLD_MINUTES while the buyer authorizes.
 *   close       (host intent, deadline, or the cron) authorized slots >= threshold ->
 *               CONFIRMED: capture every authorization (orders become PAID and are
 *               dispatched); else FAILED: release every authorization, cancel the orders and
 *               tell the buyers. Unauthorized claims always expire and are released.
 *
 * Lock order: drop row, then show row (appendLiveEvent), then payment rows. Settlement
 * (capture / release) runs after the closing transaction commits and is re-run by the
 * sweep, so a crash between the two never strands an authorization.
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { ClaimSlotsRequest, ClaimSlotsResponse, DropView, HostIntent, SlotClaimStatus, ViewerClaim } from '../../contracts/live';
import { buildOrderUrl, createOrderAccessToken, hashOrderAccessToken } from '../auth/order-link';
import type { ViewerContext } from '../auth/viewer';
import { getDb, withTx, type DbOrTx } from '../db';
import { drops, orders, payments, quotes, shops, slotClaims } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId, newOrderNumber } from '../ids';
import { notify } from '../notify';
import { captureAuthorizedPayment, releaseOrderPayment } from '../orders/authorization';
import { promisedShipDateFor } from '../orders/checkout';
import { SEALED_TOKEN_KEY, orderUrlFromPaymentMetadata, sealOrderToken } from '../orders/link-vault';
import { getPaymentProvider } from '../payments';
import { CAPTURE_METHOD_METADATA_KEY } from '../payments/dev';
import { createQuote, isQuoteOrderable } from '../quote';
import { publicName, type ShowAccess } from './access';
import { appendLiveEvent, SYSTEM_LIVE_ACTOR, type LiveActor } from './events';
import { loadBuildFacts } from './featured';
import { toDropView, type DropRow } from './views';

/** Slots stay held this long while the buyer authorizes payment (Stripe sessions live >= 30 min). */
export const CLAIM_HOLD_MINUTES = 35;
/** `drop.ending` is announced once, this long before the deadline. */
export const DROP_ENDING_WINDOW_MS = 5 * 60_000;

const ACTIVE_CLAIMS: SlotClaimStatus[] = ['RESERVED', 'AUTHORIZED', 'CAPTURED'];
const LIVE_SYSTEM_ACTOR: Actor = { kind: 'system', id: 'live' };

type StartDropIntent = Extract<HostIntent, { intent: 'start_drop' }>;
type QuoteRow = typeof quotes.$inferSelect;

/** Lowest price per slot a drop may charge for a quote: its unit price, or its subtotal per unit when a minimum applies. */
export function minimumSlotPriceCents(quote: Pick<QuoteRow, 'unitPriceCents' | 'subtotalCents' | 'quantity'>): number {
    return Math.max(quote.unitPriceCents, Math.ceil(quote.subtotalCents / Math.max(1, quote.quantity)));
}

/** The orderable BINDING quote at exactly `quantity` units for the build's part, creating one from the latest config if needed. */
async function bindingQuoteAt(buildId: string, quantity: number): Promise<QuoteRow> {
    const facts = await loadBuildFacts(buildId);
    if (!facts) throw new ApiError('NOT_FOUND', 'Build not found');
    const part = facts.part;
    if (!part) throw new ApiError('CONFLICT', 'This build has no quotable part yet. Upload or generate a flat pattern and get a binding quote first.');
    const fresh = (q: QuoteRow) => isQuoteOrderable(q, { designVersion: part.designVersion, rulesetVersion: part.rulesetVersion });
    const db = getDb();
    const atQty = (await db.select().from(quotes).where(and(eq(quotes.partId, part.id), eq(quotes.quantity, quantity), eq(quotes.status, 'READY'), eq(quotes.trustLevel, 'BINDING'))).orderBy(sql`${quotes.createdAt} desc`).limit(10)).find(fresh);
    if (atQty) return atQty;
    const template = facts.quote;
    if (!template) throw new ApiError('CONFLICT', 'Get a binding quote for this build before starting a drop.');
    const view = await createQuote({ ...template.config, quantity });
    if (view.status !== 'READY' || view.trustLevel !== 'BINDING' || !view.orderable) {
        throw new ApiError('CONFLICT', `There is no binding quote at ${quantity} units for this build (the quote engine answered ${view.status}). Change the threshold or the configuration.`);
    }
    const [row] = await db.select().from(quotes).where(eq(quotes.id, view.id));
    return row;
}

export async function startDrop(access: ShowAccess, intent: StartDropIntent, actor: LiveActor): Promise<DropView> {
    const { show, channel } = access;
    if (show.status !== 'LIVE' && show.status !== 'SCHEDULED') throw new ApiError('CONFLICT', 'Drops can only start before or during a show.');
    if (intent.thresholdSlots > intent.totalSlots) throw new ApiError('VALIDATION_FAILED', 'The production threshold cannot be larger than the number of slots.');
    if (intent.perBuyerLimit > intent.totalSlots) throw new ApiError('VALIDATION_FAILED', 'The per-buyer limit cannot be larger than the number of slots.');
    const quote = await bindingQuoteAt(intent.buildId, intent.thresholdSlots);
    const floor = minimumSlotPriceCents(quote);
    if (intent.priceCents < floor) {
        throw new ApiError(
            'CONFLICT',
            `The slot price is below production cost: the binding quote at ${quote.quantity} units is ${(floor / 100).toFixed(2)} ${quote.currency.toUpperCase()} per unit.`,
            409,
            { minimumPriceCents: floor, quoteId: quote.id },
        );
    }
    const now = new Date();
    const closesAt = new Date(now.getTime() + intent.durationMinutes * 60_000);
    if (closesAt.getTime() > quote.validUntil.getTime()) {
        throw new ApiError('CONFLICT', `The drop must close before its binding quote expires (${quote.validUntil.toISOString().slice(0, 10)}). Shorten the drop.`);
    }
    const facts = await loadBuildFacts(intent.buildId);
    return withTx(async (tx) => {
        const [open] = await tx
            .select({ id: drops.id })
            .from(drops)
            .where(and(eq(drops.showId, show.id), eq(drops.status, 'OPEN')))
            .limit(1);
        if (open) throw new ApiError('CONFLICT', 'A drop is already open on this show. Close it first.');
        const [row] = await tx
            .insert(drops)
            .values({
                showId: show.id,
                channelId: channel.id,
                buildId: intent.buildId,
                quoteId: quote.id,
                title: facts?.build.name ?? 'Live drop',
                priceCents: intent.priceCents,
                currency: quote.currency,
                totalSlots: intent.totalSlots,
                thresholdSlots: intent.thresholdSlots,
                perBuyerLimit: intent.perBuyerLimit,
                status: 'OPEN',
                opensAt: now,
                closesAt,
                createdBy: actor.id,
            })
            .returning();
        const view = toDropView(row, 0);
        await appendLiveEvent(
            show.id,
            {
                event: 'drop.started',
                actor,
                buildId: row.buildId,
                designVersion: quote.designVersion,
                payload: { drop: view },
                at: now,
                domain: {
                    type: 'live.drop_started',
                    payload: { dropId: row.id, showId: show.id, buildId: row.buildId, quoteId: quote.id, priceCents: row.priceCents, totalSlots: row.totalSlots, thresholdSlots: row.thresholdSlots, closesAt: closesAt.toISOString() },
                    actor: LIVE_SYSTEM_ACTOR,
                    correlationId: show.id,
                    buildId: row.buildId,
                },
            },
            tx,
        );
        return view;
    });
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

type ClaimRow = typeof slotClaims.$inferSelect;

function dropMustBeClaimable(drop: DropRow, now: Date): void {
    if (drop.status !== 'OPEN') throw new ApiError('CONFLICT', 'This drop is closed.');
    if (drop.closesAt.getTime() <= now.getTime()) throw new ApiError('CONFLICT', 'This drop has ended.');
    if (drop.opensAt.getTime() > now.getTime()) throw new ApiError('CONFLICT', 'This drop has not opened yet.');
}

/** Effective claim status, folding in the payment (a RESERVED claim whose hold went through is AUTHORIZED). */
function effectiveStatus(claim: Pick<ClaimRow, 'status'>, paymentStatus: string | null | undefined): SlotClaimStatus {
    if (claim.status === 'RESERVED' && paymentStatus === 'AUTHORIZED') return 'AUTHORIZED';
    return claim.status;
}

/**
 * Under the drop lock: expire RESERVED claims whose hold ran out (or whose payment failed)
 * without an authorization, returning their slots. Returns the expired claims; the caller
 * releases their payments after commit.
 */
async function expireStaleClaimsLocked(tx: DbOrTx, drop: DropRow, now: Date): Promise<ClaimRow[]> {
    const rows = await tx
        .select({ claim: slotClaims, paymentStatus: payments.status })
        .from(slotClaims)
        .leftJoin(payments, eq(payments.orderId, slotClaims.orderId))
        .where(and(eq(slotClaims.dropId, drop.id), eq(slotClaims.status, 'RESERVED')));
    const stale = rows.filter((r) => r.paymentStatus !== 'AUTHORIZED' && (r.claim.expiresAt.getTime() <= now.getTime() || r.paymentStatus === 'FAILED' || r.paymentStatus === 'CANCELLED')).map((r) => r.claim);
    if (!stale.length) return [];
    const released = stale.reduce((s, c) => s + c.quantity, 0);
    await tx.update(slotClaims).set({ status: 'EXPIRED', updatedAt: now }).where(inArray(slotClaims.id, stale.map((c) => c.id)));
    const [updated] = await tx
        .update(drops)
        .set({ claimedSlots: sql`greatest(0, ${drops.claimedSlots} - ${released})`, updatedAt: now })
        .where(eq(drops.id, drop.id))
        .returning();
    drop.claimedSlots = updated.claimedSlots;
    if (drop.showId) {
        await appendLiveEvent(
            drop.showId,
            {
                event: 'inventory.change',
                actor: SYSTEM_LIVE_ACTOR,
                buildId: drop.buildId,
                payload: { dropId: drop.id, claimedSlots: updated.claimedSlots, totalSlots: updated.totalSlots, remainingSlots: updated.totalSlots - updated.claimedSlots, reason: 'claim_expired' },
                at: now,
            },
            tx,
        );
    }
    return stale;
}

async function releaseClaims(claims: Pick<ClaimRow, 'id' | 'orderId' | 'buyerEmail'>[], reason: string, finalStatus: 'RELEASED' | 'EXPIRED', dropTitle: string): Promise<number> {
    let released = 0;
    for (const c of claims) {
        try {
            await releaseOrderPayment(c.orderId, reason, LIVE_SYSTEM_ACTOR);
            await getDb().update(slotClaims).set({ status: finalStatus, updatedAt: new Date() }).where(eq(slotClaims.id, c.id));
            released++;
            const [order] = await getDb().select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, c.orderId));
            if (order) await notify('build_slot.released', { to: c.buyerEmail, orderId: c.orderId, orderNumber: order.orderNumber, dropTitle, reason });
        } catch (err) {
            console.error(`[live] releasing claim ${c.id} failed; the drop sweep will retry`, err);
        }
    }
    return released;
}

async function claimResponse(claim: ClaimRow, drop: DropRow, viewerClaimed: number, orderUrl: string, provider: { name: 'stripe' | 'dev'; providerRef: string }, totalCents: number, paymentStatus?: string | null): Promise<ClaimSlotsResponse> {
    return {
        claimId: claim.id,
        orderId: claim.orderId,
        checkoutUrl: claim.checkoutUrl,
        drop: toDropView(drop, viewerClaimed),
        status: effectiveStatus(claim, paymentStatus),
        orderUrl,
        payment: { provider: provider.name, providerRef: provider.providerRef },
        totalCents,
        expiresAt: claim.expiresAt.toISOString(),
    };
}

async function viewerClaimedSlots(db: DbOrTx, dropId: string, userId: string): Promise<number> {
    const [r] = await db
        .select({ n: sql<number>`coalesce(sum(${slotClaims.quantity}), 0)::int` })
        .from(slotClaims)
        .where(and(eq(slotClaims.dropId, dropId), eq(slotClaims.userId, userId), inArray(slotClaims.status, ACTIVE_CLAIMS)));
    return Number(r?.n ?? 0);
}

/**
 * Claim Build Slots. Serialized per drop by the row lock; idempotent per
 * (drop, viewer, Idempotency-Key). The order total = slot price x quantity + the quote's
 * shipping price for the chosen method; the hold is authorized, never captured here.
 */
export async function claimSlots(dropId: string, viewer: ViewerContext, input: ClaimSlotsRequest, idempotencyKey: string | null): Promise<ClaimSlotsResponse> {
    await maybeCloseDrop(dropId);
    const provider = getPaymentProvider();
    const appUrl = env().APP_URL;
    const userId = viewer.user.id;
    const expiredToRelease: ClaimRow[] = [];
    let title = 'Live drop';

    for (let attempt = 0; attempt < 3; attempt++) {
        expiredToRelease.length = 0;
        try {
            const result = await withTx(async (tx) => {
                const [drop] = await tx.select().from(drops).where(eq(drops.id, dropId)).for('update');
                if (!drop) throw new ApiError('NOT_FOUND', 'Drop not found');
                title = drop.title;

                if (idempotencyKey) {
                    const [existing] = await tx
                        .select({ claim: slotClaims, payment: payments })
                        .from(slotClaims)
                        .leftJoin(payments, eq(payments.orderId, slotClaims.orderId))
                        .where(and(eq(slotClaims.dropId, dropId), eq(slotClaims.userId, userId), eq(slotClaims.idempotencyKey, idempotencyKey)))
                        .limit(1);
                    if (existing) {
                        const orderUrl = orderUrlFromPaymentMetadata(existing.claim.orderId, existing.payment?.metadata);
                        const [order] = await tx.select({ totalCents: orders.totalCents }).from(orders).where(eq(orders.id, existing.claim.orderId));
                        return claimResponse(
                            existing.claim,
                            drop,
                            await viewerClaimedSlots(tx, dropId, userId),
                            orderUrl ?? new URL(`/orders/${existing.claim.orderId}`, appUrl).toString(),
                            { name: existing.payment?.provider ?? provider.name, providerRef: existing.payment?.providerRef ?? '' },
                            order?.totalCents ?? 0,
                            existing.payment?.status,
                        );
                    }
                }

                const now = new Date();
                expiredToRelease.push(...(await expireStaleClaimsLocked(tx, drop, now)));
                dropMustBeClaimable(drop, now);

                const mine = await viewerClaimedSlots(tx, dropId, userId);
                if (mine + input.quantity > drop.perBuyerLimit) {
                    const left = Math.max(0, drop.perBuyerLimit - mine);
                    throw new ApiError('CONFLICT', left === 0 ? `You already hold the maximum of ${drop.perBuyerLimit} slots for this drop.` : `You can claim ${left} more slot${left === 1 ? '' : 's'} on this drop.`, 409, { perBuyerLimit: drop.perBuyerLimit, held: mine });
                }
                const remaining = drop.totalSlots - drop.claimedSlots;
                if (input.quantity > remaining) {
                    throw new ApiError('CONFLICT', remaining === 0 ? 'Sold out: every slot is claimed.' : `Only ${remaining} slot${remaining === 1 ? '' : 's'} left.`, 409, { remainingSlots: remaining });
                }

                const [quote] = await tx.select().from(quotes).where(eq(quotes.id, drop.quoteId));
                if (!quote) throw new ApiError('CONFLICT', 'This drop is no longer available.');
                const shipping = quote.shippingOptions.find((o) => o.method === input.shippingMethod);
                if (!shipping) throw new ApiError('VALIDATION_FAILED', `Shipping method ${input.shippingMethod} is not available for this drop.`);
                const [shop] = await tx.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, quote.shopId));

                const quantity = input.quantity;
                const subtotalCents = drop.priceCents * quantity;
                const shopCostCents = Math.min(subtotalCents, Math.round((quote.shopCostCents * quantity) / Math.max(1, quote.quantity)));
                const platformFeeCents = subtotalCents - shopCostCents;
                const totalCents = subtotalCents + shipping.priceCents;
                const orderId = newId('order');
                const orderNumber = newOrderNumber();
                const claimId = newId('slotClaim');
                const token = createOrderAccessToken();
                const orderUrl = buildOrderUrl(orderId, token, appUrl);
                const expiresAt = new Date(Math.min(now.getTime() + CLAIM_HOLD_MINUTES * 60_000, drop.closesAt.getTime() + CLAIM_HOLD_MINUTES * 60_000));

                await tx.insert(orders).values({
                    id: orderId,
                    orderNumber,
                    buildId: drop.buildId,
                    quoteId: quote.id,
                    orderType: 'BUILD_SLOT',
                    status: 'PENDING_PAYMENT',
                    buyerEmail: viewer.user.email,
                    buyerName: input.buyer.name,
                    buyerPhone: input.buyer.phone ?? null,
                    shippingAddress: input.shippingAddress,
                    shippingMethod: input.shippingMethod,
                    notes: `Build Slot · ${drop.title} · drop ${drop.id}`,
                    quantity,
                    unitPriceCents: drop.priceCents,
                    subtotalCents,
                    shippingCents: shipping.priceCents,
                    taxCents: 0,
                    totalCents,
                    shopCostCents,
                    platformFeeCents,
                    currency: drop.currency,
                    promisedShipDate: promisedShipDateFor(quote, shop?.timezone ?? 'America/New_York', drop.closesAt),
                    accessTokenHash: hashOrderAccessToken(orderId, token),
                    correlationId: drop.buildId,
                    termsAcceptedAt: now,
                    createdAt: now,
                    updatedAt: now,
                });
                await emitEvent(tx, {
                    type: 'order.created',
                    payload: { orderId, orderNumber, quoteId: quote.id, orderType: 'BUILD_SLOT', totalCents, currency: drop.currency },
                    actor: { kind: 'buyer', id: userId },
                    correlationId: drop.buildId,
                    buildId: drop.buildId,
                    orderId,
                    timestamp: now,
                });

                const returnTo = drop.showId ? `/live/${encodeURIComponent(drop.showId)}?claim=${encodeURIComponent(claimId)}` : `/orders/${orderId}`;
                let session;
                try {
                    session = await provider.createPayment({
                        orderId,
                        orderNumber,
                        amountCents: totalCents,
                        currency: drop.currency,
                        buyerEmail: viewer.user.email,
                        description: `${orderNumber} · ${quantity} Build Slot${quantity === 1 ? '' : 's'} · ${drop.title} (charged only if the drop reaches ${drop.thresholdSlots})`,
                        successUrl: new URL(returnTo, appUrl).toString(),
                        cancelUrl: new URL(`${returnTo}${returnTo.includes('?') ? '&' : '?'}cancelled=1`, appUrl).toString(),
                        metadata: { dm_drop_id: drop.id, dm_claim_id: claimId, dm_build_id: drop.buildId, dm_app: new URL(appUrl).host },
                        expiresAt,
                        captureMethod: 'manual',
                    });
                } catch (err) {
                    console.error('[live] payment provider error on claim', err);
                    throw new ApiError('PAYMENT_ERROR', 'We could not start the payment hold. Please try again in a moment.');
                }
                await tx.insert(payments).values({
                    orderId,
                    provider: provider.name,
                    providerRef: session.providerRef,
                    amountCents: totalCents,
                    currency: drop.currency,
                    status: 'PENDING',
                    metadata: { [SEALED_TOKEN_KEY]: sealOrderToken(orderId, token), [CAPTURE_METHOD_METADATA_KEY]: 'manual', dropId: drop.id, claimId },
                    createdAt: now,
                    updatedAt: now,
                });
                const [claim] = await tx
                    .insert(slotClaims)
                    .values({ id: claimId, dropId, userId, buyerEmail: viewer.user.email, quantity, status: 'RESERVED', orderId, checkoutUrl: session.redirectUrl, idempotencyKey, expiresAt, createdAt: now, updatedAt: now })
                    .returning();
                const [updated] = await tx
                    .update(drops)
                    .set({ claimedSlots: sql`${drops.claimedSlots} + ${quantity}`, updatedAt: now })
                    .where(eq(drops.id, dropId))
                    .returning();

                if (drop.showId) {
                    await appendLiveEvent(
                        drop.showId,
                        {
                            event: 'build_slot.claimed',
                            actor: SYSTEM_LIVE_ACTOR,
                            buildId: drop.buildId,
                            payload: { dropId, quantity, claimedSlots: updated.claimedSlots, totalSlots: updated.totalSlots, remainingSlots: updated.totalSlots - updated.claimedSlots, thresholdSlots: updated.thresholdSlots, buyer: publicName(viewer) },
                            at: now,
                            domain: {
                                type: 'live.slot_claimed',
                                payload: { dropId, claimId, orderId, quantity, claimedSlots: updated.claimedSlots },
                                actor: LIVE_SYSTEM_ACTOR,
                                correlationId: drop.showId,
                                buildId: drop.buildId,
                            },
                        },
                        tx,
                    );
                    await appendLiveEvent(drop.showId, { event: 'order.created', actor: SYSTEM_LIVE_ACTOR, buildId: drop.buildId, payload: { orderType: 'BUILD_SLOT', dropId, quantity }, at: now }, tx);
                }
                return claimResponse(claim, updated, mine + quantity, orderUrl, { name: provider.name, providerRef: session.providerRef }, totalCents, 'PENDING');
            });
            if (expiredToRelease.length) await releaseClaims(expiredToRelease, 'Your slot hold expired before the payment was authorized.', 'EXPIRED', title);
            return result;
        } catch (err) {
            const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
            const constraint = e.constraint_name ?? e.cause?.constraint_name;
            if ((e.code === '23505' || e.cause?.code === '23505') && constraint === 'orders_order_number_uq' && attempt < 2) continue;
            if ((e.code === '23505' || e.cause?.code === '23505') && constraint === 'slot_claims_idempotency_uq' && attempt < 2) continue;
            throw err;
        }
    }
    throw new ApiError('INTERNAL', 'Could not allocate an order number');
}

// ---------------------------------------------------------------------------
// Closing + settlement
// ---------------------------------------------------------------------------

/**
 * Close a drop. Idempotent: a drop that is no longer OPEN is returned as is (after re-running
 * settlement for anything left unsettled).
 */
export async function closeDrop(dropId: string, actor: LiveActor, reason: 'host' | 'deadline'): Promise<DropView> {
    const outcome = await withTx(async (tx) => {
        const [drop] = await tx.select().from(drops).where(eq(drops.id, dropId)).for('update');
        if (!drop) throw new ApiError('NOT_FOUND', 'Drop not found');
        if (drop.status !== 'OPEN') return { drop, closedNow: false, expired: [] as ClaimRow[] };
        const now = new Date();
        const expired = await expireStaleClaimsLocked(tx, drop, now);
        const rows = await tx
            .select({ claim: slotClaims, paymentStatus: payments.status })
            .from(slotClaims)
            .leftJoin(payments, eq(payments.orderId, slotClaims.orderId))
            .where(and(eq(slotClaims.dropId, dropId), inArray(slotClaims.status, ['RESERVED', 'AUTHORIZED'])));
        const authorized = rows.filter((r) => r.claim.status === 'AUTHORIZED' || r.paymentStatus === 'AUTHORIZED');
        const authorizedQty = authorized.reduce((s, r) => s + r.claim.quantity, 0);
        const status = authorizedQty >= drop.thresholdSlots ? ('CONFIRMED' as const) : ('FAILED' as const);
        if (authorized.length) {
            await tx.update(slotClaims).set({ status: 'AUTHORIZED', updatedAt: now }).where(inArray(slotClaims.id, authorized.map((r) => r.claim.id)));
        }
        const [closed] = await tx.update(drops).set({ status, claimedSlots: authorizedQty, closedAt: now, updatedAt: now }).where(eq(drops.id, dropId)).returning();
        if (drop.showId) {
            await appendLiveEvent(
                drop.showId,
                {
                    event: 'drop.closed',
                    actor,
                    buildId: drop.buildId,
                    payload: { dropId, status, claimedSlots: authorizedQty, thresholdSlots: drop.thresholdSlots, totalSlots: drop.totalSlots, reason },
                    at: now,
                    domain: {
                        type: 'live.drop_closed',
                        payload: { dropId, status, claimedSlots: authorizedQty, thresholdSlots: drop.thresholdSlots, captured: status === 'CONFIRMED' ? authorized.length : 0, released: rows.length - (status === 'CONFIRMED' ? authorized.length : 0) },
                        actor: LIVE_SYSTEM_ACTOR,
                        correlationId: drop.showId,
                        buildId: drop.buildId,
                    },
                },
                tx,
            );
        }
        return { drop: closed, closedNow: true, expired };
    });
    if (outcome.expired.length) await releaseClaims(outcome.expired, 'Your slot hold expired before the payment was authorized.', 'EXPIRED', outcome.drop.title);
    await settleDropClaims(dropId);
    const [fresh] = await getDb().select().from(drops).where(eq(drops.id, dropId));
    return toDropView(fresh ?? outcome.drop, 0);
}

/**
 * Capture or release every unsettled claim of a closed drop. Safe to re-run (each step is
 * idempotent: captureAuthorizedPayment / releaseOrderPayment lock and check the payment).
 */
export async function settleDropClaims(dropId: string): Promise<{ captured: number; released: number }> {
    const db = getDb();
    const [drop] = await db.select().from(drops).where(eq(drops.id, dropId));
    if (!drop || (drop.status !== 'CONFIRMED' && drop.status !== 'FAILED')) return { captured: 0, released: 0 };
    const pending = await db
        .select()
        .from(slotClaims)
        .where(and(eq(slotClaims.dropId, dropId), inArray(slotClaims.status, ['RESERVED', 'AUTHORIZED'])))
        .orderBy(asc(slotClaims.createdAt));
    let captured = 0;
    const toRelease: { claim: ClaimRow; status: 'RELEASED' | 'EXPIRED' }[] = [];
    for (const claim of pending) {
        if (drop.status === 'CONFIRMED' && claim.status === 'AUTHORIZED') {
            try {
                if (await captureAuthorizedPayment(claim.orderId)) {
                    await db.update(slotClaims).set({ status: 'CAPTURED', updatedAt: new Date() }).where(eq(slotClaims.id, claim.id));
                    captured++;
                } else {
                    toRelease.push({ claim, status: 'EXPIRED' });
                }
            } catch (err) {
                console.error(`[live] capture for claim ${claim.id} failed; the drop sweep will retry`, err);
                await notify('ops.alert', { subject: `Build Slot capture failed (${drop.title})`, message: `Capturing the hold for claim ${claim.id} (order ${claim.orderId}) failed: ${err instanceof Error ? err.message : String(err)}. The drop sweep retries; check the payment at the provider.`, orderId: claim.orderId });
            }
        } else {
            toRelease.push({ claim, status: drop.status === 'FAILED' && claim.status === 'AUTHORIZED' ? 'RELEASED' : 'EXPIRED' });
        }
    }
    const reason =
        drop.status === 'FAILED'
            ? `The drop closed with ${drop.claimedSlots} of the ${drop.thresholdSlots} slots needed to start production.`
            : 'Your slot hold expired before the payment was authorized.';
    let released = 0;
    for (const status of ['RELEASED', 'EXPIRED'] as const) {
        const group = toRelease.filter((r) => r.status === status).map((r) => r.claim);
        if (group.length) released += await releaseClaims(group, status === 'RELEASED' ? reason : 'Your slot hold expired before the payment was authorized.', status, drop.title);
    }
    return { captured, released };
}

/** Lazily close an overdue drop, and announce `drop.ending` once inside the final window. */
export async function maybeCloseDrop(dropId: string, now: Date = new Date()): Promise<void> {
    const [drop] = await getDb().select().from(drops).where(eq(drops.id, dropId));
    if (!drop || drop.status !== 'OPEN') return;
    if (drop.closesAt.getTime() <= now.getTime()) {
        await closeDrop(dropId, SYSTEM_LIVE_ACTOR, 'deadline');
        return;
    }
    if (!drop.endingNotifiedAt && drop.closesAt.getTime() - now.getTime() <= DROP_ENDING_WINDOW_MS && drop.showId) {
        await withTx(async (tx) => {
            const [locked] = await tx.select().from(drops).where(eq(drops.id, dropId)).for('update');
            if (!locked || locked.status !== 'OPEN' || locked.endingNotifiedAt || !locked.showId) return;
            await tx.update(drops).set({ endingNotifiedAt: now }).where(eq(drops.id, dropId));
            await appendLiveEvent(locked.showId, { event: 'drop.ending', actor: SYSTEM_LIVE_ACTOR, buildId: locked.buildId, payload: { dropId, closesAt: locked.closesAt.toISOString(), claimedSlots: locked.claimedSlots, totalSlots: locked.totalSlots }, at: now }, tx);
        });
    }
}

/** Cron / admin: close every overdue drop and finish any unsettled settlement. */
export async function sweepDrops(now: Date = new Date()): Promise<{ closed: number; expiredClaims: number }> {
    const db = getDb();
    const overdue = await db.select({ id: drops.id }).from(drops).where(and(eq(drops.status, 'OPEN'), lte(drops.closesAt, now)));
    for (const d of overdue) await closeDrop(d.id, SYSTEM_LIVE_ACTOR, 'deadline');
    let expiredClaims = 0;
    // Open drops: return the slots of holds that ran out.
    const open = await db.select({ id: drops.id }).from(drops).where(eq(drops.status, 'OPEN'));
    for (const d of open) {
        const expired = await withTx(async (tx) => {
            const [drop] = await tx.select().from(drops).where(eq(drops.id, d.id)).for('update');
            return drop && drop.status === 'OPEN' ? expireStaleClaimsLocked(tx, drop, now) : [];
        });
        expiredClaims += expired.length;
        if (expired.length) await releaseClaims(expired, 'Your slot hold expired before the payment was authorized.', 'EXPIRED', 'the drop');
    }
    // Closed drops with unsettled claims (crash between close and settlement).
    const unsettled = await db
        .selectDistinct({ id: slotClaims.dropId })
        .from(slotClaims)
        .innerJoin(drops, eq(drops.id, slotClaims.dropId))
        .where(and(inArray(drops.status, ['CONFIRMED', 'FAILED']), inArray(slotClaims.status, ['RESERVED', 'AUTHORIZED'])));
    for (const d of unsettled) await settleDropClaims(d.id);
    return { closed: overdue.length, expiredClaims };
}

/** The show's current drop (the open one, else the most recent), for snapshots. */
export async function currentDropForShow(showId: string, db: DbOrTx = getDb()): Promise<DropRow | null> {
    const [open] = await db
        .select()
        .from(drops)
        .where(and(eq(drops.showId, showId), eq(drops.status, 'OPEN')))
        .limit(1);
    if (open) return open;
    const [latest] = await db.select().from(drops).where(eq(drops.showId, showId)).orderBy(sql`${drops.createdAt} desc`).limit(1);
    return latest ?? null;
}

export async function getDropView(dropId: string, viewerId: string | null): Promise<DropView | null> {
    await maybeCloseDrop(dropId);
    const db = getDb();
    const [drop] = await db.select().from(drops).where(eq(drops.id, dropId));
    if (!drop) return null;
    return toDropView(drop, viewerId ? await viewerClaimedSlots(db, dropId, viewerId) : 0);
}

/** The viewer's claims on a drop, with their signed order links. */
export async function viewerClaimsFor(dropId: string, userId: string, db: DbOrTx = getDb()): Promise<{ claims: ViewerClaim[]; held: number }> {
    const rows = await db
        .select({ claim: slotClaims, payment: payments })
        .from(slotClaims)
        .leftJoin(payments, eq(payments.orderId, slotClaims.orderId))
        .where(and(eq(slotClaims.dropId, dropId), eq(slotClaims.userId, userId)))
        .orderBy(asc(slotClaims.createdAt));
    const claims = rows.map((r) => ({
        claimId: r.claim.id,
        orderId: r.claim.orderId,
        quantity: r.claim.quantity,
        status: effectiveStatus(r.claim, r.payment?.status),
        orderUrl: orderUrlFromPaymentMetadata(r.claim.orderId, r.payment?.metadata),
        expiresAt: r.claim.expiresAt.toISOString(),
    }));
    const held = rows.filter((r) => ACTIVE_CLAIMS.includes(r.claim.status)).reduce((s, r) => s + r.claim.quantity, 0);
    return { claims, held };
}
