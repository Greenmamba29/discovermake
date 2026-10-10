/**
 * "Ask a grown-up" requests and the order status that flows back to the kid.
 *
 *   askGrownUp        kid: a priced design within the spending limit -> a pending request + email
 *   approveKidRequest grown-up: -> their normal checkout for the BINDING quote (re-quoted if stale)
 *   declineKidRequest grown-up: "Not this time" with an optional kind note
 *   listKidThings     kid: "My things" from the request and the grown-up's real order
 *
 * The order is the grown-up's own (orders.buyer_user_id): Prime free shipping, guaranteed dates
 * and priority apply at checkout exactly as for any other order they place.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { KID_STAGE_COPY, kidDesignOptions, kidPrice, kidStageFor, type FamilyRequestView, type KidAvatar, type KidRequestStatus, type KidThingView } from '@/contracts/kids';
import type { OrderStatus } from '@/contracts/enums';
import { KID_TEMPLATES, type KidTemplateId } from '@/contracts/text-to-cad';
import { getDb, withTx } from '../db';
import { builds, cartItems, kidDesigns, kidProfiles, kidRequests, orders, parts, printQuoteDetails, quotes, upsellOffers } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../http';
import { newId } from '../ids';
import { notify } from '../notify';
import { getQuote } from '../quote';
import { getStorage } from '../storage';
import { glbUrlFor, loadKidDesign, quoteDesign } from './designs';
import { logActivity } from './activity';
import type { KidSession } from './session';

type RequestRow = typeof kidRequests.$inferSelect;
type OrderLite = { orderId: string; orderNumber: string; status: OrderStatus; quoteId: string };

/** The grown-up's latest order for each quote (orders they placed while signed in). */
async function ordersFor(ownerUserId: string, quoteIds: string[]): Promise<Map<string, OrderLite>> {
    if (!quoteIds.length) return new Map();
    const rows = await getDb()
        .select({ orderId: orders.id, orderNumber: orders.orderNumber, status: orders.status, quoteId: orders.quoteId, createdAt: orders.createdAt })
        .from(orders)
        .where(and(eq(orders.buyerUserId, ownerUserId), inArray(orders.quoteId, quoteIds)))
        .orderBy(desc(orders.createdAt));
    const out = new Map<string, OrderLite>();
    for (const r of rows) {
        const current = out.get(r.quoteId);
        // Prefer a paid order over an abandoned PENDING_PAYMENT one.
        const unpaid = (s: OrderStatus) => s === 'PENDING_PAYMENT' || s === 'PAYMENT_FAILED';
        if (!current || (unpaid(current.status) && !unpaid(r.status))) out.set(r.quoteId, { orderId: r.orderId, orderNumber: r.orderNumber, status: r.status, quoteId: r.quoteId });
    }
    return out;
}

const title = (t: string) => KID_TEMPLATES[t as KidTemplateId]?.title ?? 'Project';

function toThing(r: RequestRow & { template: string; params: Record<string, unknown> }, order: OrderLite | undefined): KidThingView {
    const stage = kidStageFor({ status: r.status as KidRequestStatus }, order?.status ?? null);
    return {
        id: r.id,
        template: r.template as KidTemplateId,
        templateTitle: title(r.template),
        options: kidDesignOptions(r.template as KidTemplateId, r.params),
        priceCents: r.priceCents,
        stage,
        stageText: KID_STAGE_COPY[stage],
        note: r.status === 'declined' ? r.note : null,
        createdAt: r.createdAt.toISOString(),
    };
}

export class OverSpendingLimitError extends ApiError {
    constructor(priceCents: number, limitCents: number) {
        super('CONFLICT', `That costs ${kidPrice(priceCents)}. Your grown-up said up to ${kidPrice(limitCents)}. Pick a smaller option.`, 409, { reason: 'OVER_LIMIT', priceCents, limitCents });
    }
}

export async function askGrownUp(kid: KidSession, designId: string): Promise<KidThingView> {
    const design = await loadKidDesign(kid, designId);
    if (design.status !== 'priced' || !design.quoteId || design.priceCents === null) throw new ApiError('CONFLICT', 'This one has no price yet. Tap “See my price” first.', 409);
    if (design.priceCents > kid.kid.spendingLimitCents) throw new OverSpendingLimitError(design.priceCents, kid.kid.spendingLimitCents);
    const q = await getQuote(design.quoteId);
    if (!q?.orderable) throw new ApiError('CONFLICT', 'This price is too old. Tap “See my price” again.', 409);

    const [existing] = await getDb().select().from(kidRequests).where(eq(kidRequests.designId, design.id)).limit(1);
    if (existing) {
        const order = (await ordersFor(kid.ownerUserId, [existing.quoteId])).get(existing.quoteId);
        return toThing({ ...existing, template: design.template, params: design.params }, order);
    }
    const row = await withTx(async (tx) => {
        const [inserted] = await tx
            .insert(kidRequests)
            .values({ id: newId('kidRequest'), kidId: kid.kid.id, designId: design.id, ownerUserId: kid.ownerUserId, quoteId: design.quoteId!, priceCents: design.priceCents!, currency: design.currency, status: 'pending' })
            .returning();
        await logActivity(tx, kid.ownerUserId, kid.kid.id, 'request_created', `${kid.kid.nickname} asked for a ${title(design.template)} (${kidPrice(design.priceCents!)})`);
        return inserted!;
    });
    // To the grown-up's account email only: the kid has no email and none is ever asked for.
    await notify('family.kid_request', {
        to: kid.ownerEmail,
        requestId: row.id,
        kidNickname: kid.kid.nickname,
        templateTitle: title(design.template),
        priceCents: row.priceCents,
        currency: row.currency,
        familyUrl: `${env().APP_URL}/family#requests`,
    });
    return toThing({ ...row, template: design.template, params: design.params }, undefined);
}

export async function listKidThings(kid: KidSession): Promise<KidThingView[]> {
    const rows = await getDb()
        .select({ r: kidRequests, template: kidDesigns.template, params: kidDesigns.params })
        .from(kidRequests)
        .innerJoin(kidDesigns, eq(kidDesigns.id, kidRequests.designId))
        .where(and(eq(kidRequests.kidId, kid.kid.id), eq(kidRequests.ownerUserId, kid.ownerUserId)))
        .orderBy(desc(kidRequests.createdAt))
        .limit(50);
    const byQuote = await ordersFor(kid.ownerUserId, rows.map((x) => x.r.quoteId));
    return rows.map((x) => toThing({ ...x.r, template: x.template, params: x.params }, byQuote.get(x.r.quoteId)));
}

export async function listFamilyRequests(ownerUserId: string): Promise<FamilyRequestView[]> {
    const rows = await getDb()
        .select({ r: kidRequests, template: kidDesigns.template, params: kidDesigns.params, cad: kidDesigns.cad, nickname: kidProfiles.nickname, avatar: kidProfiles.avatar })
        .from(kidRequests)
        .innerJoin(kidDesigns, eq(kidDesigns.id, kidRequests.designId))
        .innerJoin(kidProfiles, eq(kidProfiles.id, kidRequests.kidId))
        .where(eq(kidRequests.ownerUserId, ownerUserId))
        .orderBy(desc(kidRequests.createdAt))
        .limit(50);
    const byQuote = await ordersFor(ownerUserId, rows.map((x) => x.r.quoteId));
    return Promise.all(
        rows.map(async (x): Promise<FamilyRequestView> => {
            const order = byQuote.get(x.r.quoteId);
            const status = x.r.status as KidRequestStatus;
            return {
                id: x.r.id,
                kidId: x.r.kidId,
                kidNickname: x.nickname,
                kidAvatar: x.avatar as KidAvatar,
                template: x.template as KidTemplateId,
                templateTitle: title(x.template),
                options: kidDesignOptions(x.template as KidTemplateId, x.params),
                priceCents: x.r.priceCents,
                currency: x.r.currency,
                quoteId: x.r.quoteId,
                status,
                note: x.r.note,
                stage: kidStageFor({ status }, order?.status ?? null),
                order: order ? { orderId: order.orderId, orderNumber: order.orderNumber, status: order.status } : null,
                glbUrl: await glbUrlFor(x.cad),
                createdAt: x.r.createdAt.toISOString(),
                decidedAt: x.r.decidedAt?.toISOString() ?? null,
            };
        }),
    );
}

async function loadRequest(ownerUserId: string, requestId: string): Promise<RequestRow> {
    const [row] = await getDb()
        .select()
        .from(kidRequests)
        .where(and(eq(kidRequests.id, requestId), eq(kidRequests.ownerUserId, ownerUserId)))
        .limit(1);
    if (!row) throw new ApiError('NOT_FOUND', 'Request not found');
    return row;
}

const PAID = (s: OrderStatus) => s !== 'PENDING_PAYMENT' && s !== 'PAYMENT_FAILED';

/** Approve & pay: the grown-up's normal checkout for this request's BINDING quote. */
export async function approveKidRequest(ownerUserId: string, requestId: string, now: Date = new Date()): Promise<{ checkoutUrl: string; quoteId: string }> {
    let request = await loadRequest(ownerUserId, requestId);
    if (request.status === 'declined') throw new ApiError('CONFLICT', 'You already said not this time to this request.', 409);
    const existing = (await ordersFor(ownerUserId, [request.quoteId])).get(request.quoteId);
    if (existing && PAID(existing.status)) throw new ApiError('CONFLICT', `Already paid: order ${existing.orderNumber}.`, 409);

    const quote = await getQuote(request.quoteId);
    if (!quote?.orderable) {
        // The quote went stale while waiting: price the same design again (the engine, never a guess).
        const [design] = await getDb().select().from(kidDesigns).where(eq(kidDesigns.id, request.designId)).limit(1);
        if (!design?.cad) throw new ApiError('CONFLICT', 'This design has no workshop result any more.', 409);
        const { row, quote: fresh } = await quoteDesign(design, now);
        if (row.status !== 'priced') throw new ApiError('CONFLICT', 'This design cannot be priced right now. Please try again later.', 409);
        [request] = await getDb().update(kidRequests).set({ quoteId: fresh.id, priceCents: fresh.subtotalCents, updatedAt: now }).where(eq(kidRequests.id, request.id)).returning();
    }
    if (request!.status !== 'approved') {
        await withTx(async (tx) => {
            await tx.update(kidRequests).set({ status: 'approved', decidedAt: now, updatedAt: now }).where(eq(kidRequests.id, request!.id));
            const [kid] = await tx.select({ nickname: kidProfiles.nickname }).from(kidProfiles).where(eq(kidProfiles.id, request!.kidId));
            const [design] = await tx.select({ template: kidDesigns.template }).from(kidDesigns).where(eq(kidDesigns.id, request!.designId));
            await logActivity(tx, ownerUserId, request!.kidId, 'request_approved', `Approved ${kid?.nickname ?? 'a kid'}’s ${title(design?.template ?? '')} (${kidPrice(request!.priceCents)})`);
        });
    }
    return { checkoutUrl: `/checkout/${request!.quoteId}`, quoteId: request!.quoteId };
}

export async function declineKidRequest(ownerUserId: string, requestId: string, note: string | undefined, now: Date = new Date()): Promise<{ declined: true }> {
    const request = await loadRequest(ownerUserId, requestId);
    const existing = (await ordersFor(ownerUserId, [request.quoteId])).get(request.quoteId);
    if (existing && PAID(existing.status)) throw new ApiError('CONFLICT', 'This one is already paid for.', 409);
    const kindNote = note?.trim() ? note.trim().slice(0, 140) : null;
    await withTx(async (tx) => {
        await tx.update(kidRequests).set({ status: 'declined', note: kindNote, decidedAt: now, updatedAt: now }).where(eq(kidRequests.id, request.id));
        const [kid] = await tx.select({ nickname: kidProfiles.nickname }).from(kidProfiles).where(eq(kidProfiles.id, request.kidId));
        await logActivity(tx, ownerUserId, request.kidId, 'request_declined', `Said not this time to ${kid?.nickname ?? 'a kid'}`);
    });
    return { declined: true };
}

/**
 * Remove a kid build nobody ordered (profile deletion): quotes, print details, cart lines and
 * upsell offers of its quotes, then the build (parts cascade) and the part files. A build with
 * an order is kept as the grown-up's purchase record. Best effort: failures are logged.
 */
export async function purgeUnorderedKidBuild(buildId: string): Promise<boolean> {
    try {
        const db = getDb();
        const [build] = await db.select({ origin: builds.origin }).from(builds).where(eq(builds.id, buildId));
        if (!build || build.origin !== 'kids') return false;
        const [ordered] = await db.select({ id: orders.id }).from(orders).where(eq(orders.buildId, buildId)).limit(1);
        if (ordered) return false;
        const files = await db.select({ key: parts.fileKey }).from(parts).where(eq(parts.buildId, buildId));
        await withTx(async (tx) => {
            const qs = (await tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.buildId, buildId))).map((q) => q.id);
            if (qs.length) {
                await tx.delete(cartItems).where(inArray(cartItems.quoteId, qs));
                await tx.delete(upsellOffers).where(inArray(upsellOffers.baseQuoteId, qs));
                await tx.delete(upsellOffers).where(inArray(upsellOffers.offerQuoteId, qs));
                await tx.delete(printQuoteDetails).where(inArray(printQuoteDetails.quoteId, qs));
                await tx.delete(quotes).where(inArray(quotes.id, qs));
            }
            await tx.delete(builds).where(eq(builds.id, buildId));
        });
        for (const f of files) await getStorage().deleteObject(f.key).catch(() => undefined);
        return true;
    } catch (err) {
        console.warn(`[kids] could not purge build ${buildId}: ${err instanceof Error ? err.message : err}`);
        return false;
    }
}
