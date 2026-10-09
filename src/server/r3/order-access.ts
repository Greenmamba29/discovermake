/**
 * Who may act on an order in R3 features (chat, rating, tracking map):
 *   - buyer: the signed order link token (`x-order-token` / `?t=`), or the signed-in owner
 *     (orders.buyer_user_id, or a verified email equal to the buyer email);
 *   - shop: a Shop Console session whose shop is assigned to the order;
 *   - ops: the admin token or an ops/admin session.
 * Every miss answers 404 (never reveal whether the order exists).
 */
import { eq } from 'drizzle-orm';
import { readOrderToken, verifyOrderAccessToken } from '../auth/order-link';
import { getViewer, type ViewerContext } from '../auth/viewer';
import { getDb } from '../db';
import { orders } from '../db/schema';
import { ApiError } from '../http';

export type OrderRow = typeof orders.$inferSelect;

export type ChatParty = { kind: 'buyer'; id: string } | { kind: 'shop'; id: string } | { kind: 'ops'; id: string };

const notFound = () => new ApiError('NOT_FOUND', 'Order not found');

export async function loadOrder(orderId: string): Promise<OrderRow | null> {
    if (!/^ord_[A-Za-z0-9_-]{4,60}$/.test(orderId)) return null;
    const [row] = await getDb().select().from(orders).where(eq(orders.id, orderId)).limit(1);
    return row ?? null;
}

export function isOrderOwner(order: OrderRow, viewer: ViewerContext | null): boolean {
    if (!viewer) return false;
    if (order.buyerUserId && order.buyerUserId === viewer.user.id) return true;
    return viewer.user.emailVerified && viewer.user.email.toLowerCase() === order.buyerEmail.toLowerCase();
}

/** Buyer access: token or signed-in owner. Throws 404 otherwise. */
export async function requireBuyerOrder(request: Request, orderId: string): Promise<{ order: OrderRow; viewer: ViewerContext | null; party: ChatParty }> {
    const order = await loadOrder(orderId);
    if (!order) throw notFound();
    const token = readOrderToken(request);
    const viewer = await getViewer(request);
    const byToken = token ? verifyOrderAccessToken(order.id, token, order.accessTokenHash) : false;
    if (!byToken && !isOrderOwner(order, viewer)) throw notFound();
    return { order, viewer, party: { kind: 'buyer', id: viewer && isOrderOwner(order, viewer) ? viewer.user.id : 'link' } };
}

/** Shop access: only the shop assigned to the order. */
export async function requireShopOrder(shopId: string, orderId: string): Promise<{ order: OrderRow; party: ChatParty }> {
    const order = await loadOrder(orderId);
    if (!order || order.shopId !== shopId) throw notFound();
    return { order, party: { kind: 'shop', id: shopId } };
}

export async function requireOrderExists(orderId: string): Promise<OrderRow> {
    const order = await loadOrder(orderId);
    if (!order) throw notFound();
    return order;
}
