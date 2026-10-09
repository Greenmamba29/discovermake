/**
 * Rating + UGC after delivery (DoorDash "rate your order" at the end).
 *
 * - Only DELIVERED / COMPLETE orders can be rated, once per order (unique index).
 * - Optional photo + caption ("show what you made"); photo = signed upload under
 *   `ugc/<orderId>/` with size + magic-byte checks.
 * - Every rating starts `pending`; ops approve or reject it in /admin/prime.
 * - Shop aggregates (shops.rating, shops.rating_count) are recomputed from APPROVED ratings
 *   only, in the moderation transaction, so the route cards show real numbers.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { AdminRatingItem, OrderRatingResponse, RatingTag, RatingView, SubmitRatingRequest } from '../../contracts/prime';
import { SubmitRatingRequest as SubmitRatingSchema, RATING_TAGS } from '../../contracts/prime';
import { getDb, withTx, type DbOrTx } from '../db';
import { orders, ratings, shops } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { imageUrl, verifyUploadedImage } from '../r3/images';
import type { OrderRow } from '../r3/order-access';

type RatingRow = typeof ratings.$inferSelect;

export const RATEABLE_STATUSES = new Set(['DELIVERED', 'COMPLETE']);

export function ugcPrefix(orderId: string): string {
    return `ugc/${orderId}`;
}

export async function toRatingView(r: RatingRow): Promise<RatingView> {
    return {
        id: r.id,
        orderId: r.orderId,
        stars: r.stars,
        tags: r.tags.filter((t): t is RatingTag => (RATING_TAGS as readonly string[]).includes(t)),
        caption: r.caption,
        photoUrl: await imageUrl(r.photoKey),
        status: r.status,
        rejectReason: r.rejectReason,
        createdAt: r.createdAt.toISOString(),
        moderatedAt: r.moderatedAt ? r.moderatedAt.toISOString() : null,
    };
}

async function shopSummary(shopId: string | null) {
    if (!shopId) return null;
    const [s] = await getDb().select({ name: shops.name, rating: shops.rating, ratingCount: shops.ratingCount }).from(shops).where(eq(shops.id, shopId)).limit(1);
    return s ? { name: s.name, rating: s.rating ?? null, ratingCount: s.ratingCount } : null;
}

export async function getOrderRating(order: OrderRow): Promise<OrderRatingResponse> {
    const [row] = await getDb().select().from(ratings).where(eq(ratings.orderId, order.id)).limit(1);
    const delivered = RATEABLE_STATUSES.has(order.status);
    return {
        eligible: delivered && !row,
        reason: row ? 'You already rated this order.' : delivered ? null : 'You can rate this order once it is delivered.',
        rating: row ? await toRatingView(row) : null,
        shop: await shopSummary(order.shopId),
    };
}

function isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; cause?: unknown };
    return e?.code === '23505' || (e?.cause ? isUniqueViolation(e.cause) : false);
}

export async function submitRating(order: OrderRow, raw: SubmitRatingRequest, userId: string | null, actor: Actor): Promise<OrderRatingResponse> {
    const input = SubmitRatingSchema.parse(raw);
    if (!RATEABLE_STATUSES.has(order.status)) throw new ApiError('CONFLICT', 'You can rate this order once it is delivered.');
    const photoKey = input.photoKey ? await verifyUploadedImage(input.photoKey, ugcPrefix(order.id)) : null;
    try {
        await withTx(async (tx) => {
            const [r] = await tx
                .insert(ratings)
                .values({ orderId: order.id, shopId: order.shopId, userId, stars: input.stars, tags: input.tags, caption: input.caption?.trim() || null, photoKey, status: 'pending' })
                .returning();
            await emitEvent(tx, {
                type: 'rating.submitted',
                payload: { ratingId: r.id, orderId: order.id, shopId: order.shopId, stars: r.stars, hasPhoto: Boolean(photoKey) },
                actor,
                correlationId: order.correlationId,
                buildId: order.buildId,
            });
        });
    } catch (err) {
        if (isUniqueViolation(err)) throw new ApiError('CONFLICT', 'You already rated this order.');
        throw err;
    }
    return getOrderRating(order);
}

/** Recompute a shop's public rating from approved ratings (inside the caller's tx). */
export async function recomputeShopRating(tx: DbOrTx, shopId: string): Promise<{ rating: number | null; count: number }> {
    const [agg] = await tx
        .select({ avg: sql<string | null>`avg(${ratings.stars})`, n: sql<number>`count(*)::int` })
        .from(ratings)
        .where(and(eq(ratings.shopId, shopId), eq(ratings.status, 'approved')));
    const count = agg?.n ?? 0;
    const rating = count > 0 && agg?.avg != null ? Math.round(Number(agg.avg) * 100) / 100 : null;
    await tx.update(shops).set({ rating, ratingCount: count, updatedAt: new Date() }).where(eq(shops.id, shopId));
    return { rating, count };
}

export async function moderateRating(ratingId: string, decision: 'approve' | 'reject', reason: string | null, actor: Actor): Promise<RatingView> {
    const row = await withTx(async (tx) => {
        const [r] = await tx.select().from(ratings).where(eq(ratings.id, ratingId)).for('update');
        if (!r) throw new ApiError('NOT_FOUND', 'Rating not found');
        if (r.status !== 'pending') throw new ApiError('CONFLICT', `This rating was already ${r.status}.`);
        const status = decision === 'approve' ? 'approved' : 'rejected';
        const [updated] = await tx
            .update(ratings)
            .set({ status, moderatedBy: `${actor.kind}:${actor.id}`, moderatedAt: new Date(), rejectReason: decision === 'reject' ? (reason ?? 'Does not meet the community guidelines') : null })
            .where(eq(ratings.id, ratingId))
            .returning();
        if (r.shopId) await recomputeShopRating(tx, r.shopId);
        const [order] = await tx.select({ correlationId: orders.correlationId, buildId: orders.buildId }).from(orders).where(eq(orders.id, r.orderId));
        await emitEvent(tx, {
            type: 'rating.moderated',
            payload: { ratingId, orderId: r.orderId, shopId: r.shopId, status },
            actor,
            correlationId: order?.correlationId ?? r.orderId,
            buildId: order?.buildId ?? null,
        });
        return updated;
    });
    return toRatingView(row);
}

export async function listPendingRatings(limit = 100): Promise<AdminRatingItem[]> {
    const rows = await getDb()
        .select({ rating: ratings, orderNumber: orders.orderNumber, buyerName: orders.buyerName, shopName: shops.name })
        .from(ratings)
        .innerJoin(orders, eq(orders.id, ratings.orderId))
        .leftJoin(shops, eq(shops.id, ratings.shopId))
        .where(eq(ratings.status, 'pending'))
        .orderBy(asc(ratings.createdAt))
        .limit(limit);
    return Promise.all(rows.map(async (r) => ({ ...(await toRatingView(r.rating)), orderNumber: r.orderNumber, buyerName: r.buyerName, shopName: r.shopName ?? 'Unassigned' })));
}
