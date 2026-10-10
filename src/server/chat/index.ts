/**
 * Order chat: one buyer ↔ shop / ops thread per order (Glovo help + LinkedIn quick replies).
 *
 * - Quick replies are contextual to the order status (`quickRepliesFor`).
 * - "Where is my order?" gets an immediate system reply with the plain status sentence.
 * - "Hold production" creates a hold request that ops must acknowledge; it never pauses a
 *   job by itself (the shop keeps working until ops confirm the hold with them).
 * - Bodies are capped (MAX_MESSAGE_CHARS) and stored as plain text; the UI renders links
 *   safely (http/https only, rel=noopener noreferrer nofollow). Attachments are images only,
 *   via signed upload + magic-byte check.
 * - Unread counts per party come from `order_chat_state.last_read_at`; a new message emails
 *   the other parties at most once per CHAT_NOTIFY_THROTTLE_MS per order (`last_notified_at`).
 * - Clients poll (GET every few seconds): simple and robust behind any proxy.
 */
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { OrderStatus } from '../../contracts/enums';
import { MAX_MESSAGE_CHARS, QUICK_REPLY_LABELS, type HoldRequestView, type OrderChatView, type OrderMessageView, type PostMessageRequest, type QuickReply } from '../../contracts/prime';
import { getDb, withTx } from '../db';
import { holdRequests, manufacturingJobs, orderChatState, orderMessages, orders, payments, shops } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { notify } from '../notify';
import { ORDER_STATUS_DISPLAY } from '../orders/state';
import { orderUrlFromPaymentMetadata } from '../orders/link-vault';
import { imageUrl, verifyUploadedImage } from '../r3/images';
import { sendR3Mail } from '../r3/mail';
import type { ChatParty, OrderRow } from '../r3/order-access';

export const CHAT_NOTIFY_THROTTLE_MS = 10 * 60 * 1000;
/** Per party per order: at most this many messages in CHAT_RATE_WINDOW_MS. */
export const CHAT_RATE_LIMIT = 30;
export const CHAT_RATE_WINDOW_MS = 10 * 60 * 1000;

type MessageRow = typeof orderMessages.$inferSelect;
type HoldRow = typeof holdRequests.$inferSelect;

/** Orders whose production can still be held (paid, not yet shipped). */
export const HOLDABLE: ReadonlySet<OrderStatus> = new Set(['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED']);
const IN_PRODUCTION: ReadonlySet<OrderStatus> = new Set(['ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED']);

export function chatPrefix(orderId: string): string {
    return `chat/${orderId}`;
}

/** Contextual quick-reply chips for a party at an order status. */
export function quickRepliesFor(kind: ChatParty['kind'], status: OrderStatus, hasOpenHold: boolean): QuickReply[] {
    if (kind === 'shop') return IN_PRODUCTION.has(status) || status === 'SHIPPED' ? ['send_photo'] : [];
    if (kind === 'ops') return [];
    const out: QuickReply[] = ['where_is_my_order'];
    if (IN_PRODUCTION.has(status)) out.push('approve_change', 'send_photo');
    if (HOLDABLE.has(status) && !hasOpenHold) out.push('hold_production');
    return out;
}

const QUICK_BODY: Record<ChatParty['kind'], Partial<Record<QuickReply, string>>> = {
    buyer: {
        where_is_my_order: 'Where is my order?',
        approve_change: 'I approve the change.',
        send_photo: 'Could you send a photo of my part?',
        hold_production: 'Please hold production on this order.',
    },
    shop: { send_photo: 'Here is a photo of your part.' },
    ops: {},
};

function toHoldView(h: HoldRow): HoldRequestView {
    return { id: h.id, orderId: h.orderId, status: h.status, note: h.note, requestedAt: h.createdAt.toISOString(), resolvedAt: h.resolvedAt ? h.resolvedAt.toISOString() : null };
}

async function shopName(order: OrderRow): Promise<string> {
    if (!order.shopId) return 'Partner shop';
    const [s] = await getDb().select({ name: shops.name }).from(shops).where(eq(shops.id, order.shopId)).limit(1);
    return s?.name ?? 'Partner shop';
}

async function toMessageViews(rows: MessageRow[], party: ChatParty, shopLabel: string): Promise<OrderMessageView[]> {
    return Promise.all(
        rows.map(async (m) => ({
            id: m.id,
            authorKind: m.authorKind,
            authorLabel: m.authorKind === 'buyer' ? (party.kind === 'buyer' ? 'You' : 'Buyer') : m.authorKind === 'shop' ? shopLabel : m.authorKind === 'ops' ? 'DiscoverMake support' : 'DiscoverMake',
            body: m.body,
            quickReply: (m.quickReply as QuickReply | null) ?? null,
            attachmentUrl: await imageUrl(m.attachmentKey),
            createdAt: m.createdAt.toISOString(),
            mine: m.authorKind === party.kind,
        })),
    );
}

export async function unreadCount(orderId: string, partyKind: ChatParty['kind']): Promise<number> {
    const db = getDb();
    const [state] = await db.select().from(orderChatState).where(and(eq(orderChatState.orderId, orderId), eq(orderChatState.party, partyKind))).limit(1);
    const conds = [eq(orderMessages.orderId, orderId), ne(orderMessages.authorKind, partyKind)];
    if (state?.lastReadAt) conds.push(gt(orderMessages.createdAt, state.lastReadAt));
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(orderMessages).where(and(...conds));
    return r?.n ?? 0;
}

/** Unread counts for several orders for one party (Shop Console list, ops queue). */
export async function unreadCounts(orderIds: string[], partyKind: ChatParty['kind']): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!orderIds.length) return out;
    const db = getDb();
    const rows = await db
        .select({ orderId: orderMessages.orderId, n: sql<number>`count(*)::int` })
        .from(orderMessages)
        .leftJoin(orderChatState, and(eq(orderChatState.orderId, orderMessages.orderId), eq(orderChatState.party, partyKind)))
        .where(
            and(
                inArray(orderMessages.orderId, orderIds),
                ne(orderMessages.authorKind, partyKind),
                sql`(${orderChatState.lastReadAt} is null or ${orderMessages.createdAt} > ${orderChatState.lastReadAt})`,
            ),
        )
        .groupBy(orderMessages.orderId);
    for (const r of rows) out.set(r.orderId, r.n);
    return out;
}

async function markRead(orderId: string, partyKind: ChatParty['kind'], at: Date): Promise<void> {
    await getDb()
        .insert(orderChatState)
        .values({ orderId, party: partyKind, lastReadAt: at })
        .onConflictDoUpdate({ target: [orderChatState.orderId, orderChatState.party], set: { lastReadAt: at } });
}

export async function openHold(orderId: string): Promise<HoldRow | null> {
    const [h] = await getDb()
        .select()
        .from(holdRequests)
        .where(eq(holdRequests.orderId, orderId))
        .orderBy(desc(holdRequests.createdAt))
        .limit(1);
    return h ?? null;
}

/** The thread for a party; reading marks it read for that party. */
export async function getChat(order: OrderRow, party: ChatParty, opts: { markRead?: boolean } = {}): Promise<OrderChatView> {
    const db = getDb();
    const rows = await db.select().from(orderMessages).where(eq(orderMessages.orderId, order.id)).orderBy(asc(orderMessages.createdAt)).limit(500);
    const hold = await openHold(order.id);
    const unread = await unreadCount(order.id, party.kind);
    if (opts.markRead !== false && rows.length) await markRead(order.id, party.kind, new Date());
    return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        viewer: party.kind,
        messages: await toMessageViews(rows, party, await shopName(order)),
        quickReplies: quickRepliesFor(party.kind, order.status, hold?.status === 'requested').map((key) => ({ key, label: QUICK_REPLY_LABELS[key] })),
        unreadCount: opts.markRead === false ? unread : 0,
        hold: hold ? toHoldView(hold) : null,
    };
}

function partyActor(party: ChatParty): Actor {
    if (party.kind === 'shop') return { kind: 'shop', id: party.id };
    if (party.kind === 'ops') return { kind: 'admin', id: party.id };
    return { kind: 'buyer', id: party.id };
}

/** Plain status sentence for the automatic "Where is my order?" reply. */
export function whereIsMyOrderReply(order: Pick<OrderRow, 'status' | 'promisedShipDate'>, shipment: { carrier: string; trackingNumber: string; estimatedDeliveryDate: string | null } | null): string {
    const label = ORDER_STATUS_DISPLAY[order.status].label;
    if (shipment) return `${label}. ${shipment.carrier} tracking ${shipment.trackingNumber}${shipment.estimatedDeliveryDate ? `, arriving ${shipment.estimatedDeliveryDate}` : ''}. The shop has been notified of your message.`;
    if (order.status === 'DELIVERED' || order.status === 'COMPLETE') return `${label}. The shop has been notified of your message.`;
    return `${label}. It is promised to ship by ${order.promisedShipDate}. The shop has been notified of your message.`;
}

export async function postMessage(order: OrderRow, party: ChatParty, input: PostMessageRequest): Promise<OrderChatView> {
    const db = getDb();
    const quick = input.quickReply ?? null;
    if (quick && !quickRepliesFor(party.kind, order.status, (await openHold(order.id))?.status === 'requested').includes(quick)) {
        throw new ApiError('CONFLICT', `"${QUICK_REPLY_LABELS[quick]}" is not available for this order right now.`);
    }
    const body = (input.body?.trim() || (quick ? (QUICK_BODY[party.kind][quick] ?? QUICK_REPLY_LABELS[quick]) : '') || (input.attachmentKey ? 'Photo' : '')).slice(0, MAX_MESSAGE_CHARS);
    if (!body) throw new ApiError('VALIDATION_FAILED', 'Write a message, pick a quick reply or attach a photo.');
    const attachmentKey = input.attachmentKey ? await verifyUploadedImage(input.attachmentKey, chatPrefix(order.id)) : null;

    const since = new Date(Date.now() - CHAT_RATE_WINDOW_MS);
    const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(orderMessages)
        .where(and(eq(orderMessages.orderId, order.id), eq(orderMessages.authorKind, party.kind), gt(orderMessages.createdAt, since)));
    if ((recent?.n ?? 0) >= CHAT_RATE_LIMIT) throw new ApiError('RATE_LIMITED', 'You are sending messages very quickly. Wait a few minutes and try again.');

    let holdCreated: HoldRow | null = null;
    await withTx(async (tx) => {
        const now = new Date();
        const [msg] = await tx.insert(orderMessages).values({ orderId: order.id, authorKind: party.kind, authorId: party.id, body, quickReply: quick, attachmentKey, createdAt: now }).returning();
        const ctx = { actor: partyActor(party), correlationId: order.correlationId, buildId: order.buildId, timestamp: now };
        // Not on the buyer timeline (orderId null on the row); the payload carries it.
        await emitEvent(tx, { type: 'order.message_posted', payload: { orderId: order.id, messageId: msg.id, authorKind: party.kind, quickReply: quick, hasAttachment: Boolean(attachmentKey) }, ...ctx });
        if (quick === 'where_is_my_order') {
            const { shipments } = await import('../db/schema');
            const [ship] = await tx.select().from(shipments).where(eq(shipments.orderId, order.id)).orderBy(desc(shipments.createdAt)).limit(1);
            await tx.insert(orderMessages).values({
                orderId: order.id,
                authorKind: 'system',
                authorId: 'system',
                body: whereIsMyOrderReply(order, ship ? { carrier: ship.carrier, trackingNumber: ship.trackingNumber, estimatedDeliveryDate: ship.estimatedDeliveryDate } : null),
                createdAt: new Date(now.getTime() + 1),
            });
        }
        if (quick === 'hold_production') {
            const [hold] = await tx.insert(holdRequests).values({ orderId: order.id, messageId: msg.id, status: 'requested', createdAt: now }).returning();
            holdCreated = hold;
            await emitEvent(tx, { type: 'hold.requested', payload: { holdId: hold.id, orderId: order.id, messageId: msg.id }, ...ctx });
            await tx.insert(orderMessages).values({
                orderId: order.id,
                authorKind: 'system',
                authorId: 'system',
                body: 'Hold requested. Production continues until our team confirms the hold with the shop; we will reply here.',
                createdAt: new Date(now.getTime() + 1),
            });
        }
        await tx
            .insert(orderChatState)
            .values({ orderId: order.id, party: party.kind, lastReadAt: new Date(now.getTime() + 2) })
            .onConflictDoUpdate({ target: [orderChatState.orderId, orderChatState.party], set: { lastReadAt: new Date(now.getTime() + 2) } });
    });

    if (holdCreated) {
        await notify('ops.alert', {
            subject: `Hold production requested on ${order.orderNumber}`,
            message: `The buyer asked to hold production on ${order.orderNumber} (status ${order.status}). The job continues until ops acknowledge the hold in /admin/prime and coordinate with the shop.`,
            orderId: order.id,
        });
    }
    await notifyOtherParties(order, party, body);
    const [fresh] = await db.select().from(orders).where(eq(orders.id, order.id));
    return getChat(fresh ?? order, party);
}

/** Email the other parties about a new message, throttled per order + party. */
async function notifyOtherParties(order: OrderRow, author: ChatParty, body: string): Promise<void> {
    const db = getDb();
    const now = new Date();
    const recipients: ChatParty['kind'][] = (['buyer', 'shop', 'ops'] as const).filter((k) => k !== author.kind);
    for (const party of recipients) {
        if (party === 'shop' && !order.shopId) continue;
        const cutoff = new Date(now.getTime() - CHAT_NOTIFY_THROTTLE_MS);
        // Claim the notification slot atomically (insert, or update only when the last one is older than the cutoff).
        const claimed = await db
            .insert(orderChatState)
            .values({ orderId: order.id, party, lastNotifiedAt: now })
            .onConflictDoUpdate({
                target: [orderChatState.orderId, orderChatState.party],
                set: { lastNotifiedAt: now },
                setWhere: sql`${orderChatState.lastNotifiedAt} is null or ${orderChatState.lastNotifiedAt} < ${cutoff.toISOString()}::timestamptz`,
            })
            .returning({ orderId: orderChatState.orderId });
        if (!claimed.length) continue;
        const preview = body.length > 280 ? `${body.slice(0, 277)}…` : body;
        if (party === 'buyer') {
            const [payment] = await db.select({ metadata: payments.metadata }).from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)).limit(1);
            const url = orderUrlFromPaymentMetadata(order.id, payment?.metadata);
            await sendR3Mail({
                to: order.buyerEmail,
                subject: `New message about ${order.orderNumber}`,
                paragraphs: [`${author.kind === 'shop' ? 'Your shop' : 'DiscoverMake support'} wrote:`, preview],
                ...(url ? { link: { label: 'Open the conversation', href: url } } : {}),
                idempotencyKey: `chat:${order.id}:buyer:${now.getTime()}`,
                sensitive: true,
            });
        } else if (party === 'shop') {
            const [shop] = await db.select({ email: shops.contactEmail }).from(shops).where(eq(shops.id, order.shopId!)).limit(1);
            const [job] = await db.select({ id: manufacturingJobs.id }).from(manufacturingJobs).where(and(eq(manufacturingJobs.orderId, order.id), eq(manufacturingJobs.shopId, order.shopId!))).orderBy(desc(manufacturingJobs.createdAt)).limit(1);
            if (!shop) continue;
            await sendR3Mail({
                to: shop.email,
                subject: `New buyer message · ${order.orderNumber}`,
                paragraphs: [preview],
                link: { label: 'Reply in Shop Console', href: new URL(job ? `/shop/jobs/${job.id}` : '/shop/jobs', env().APP_URL).toString() },
                idempotencyKey: `chat:${order.id}:shop:${now.getTime()}`,
            });
        } else {
            const ops = env().OPS_EMAIL;
            if (!ops) continue;
            await sendR3Mail({
                to: ops,
                subject: `[ops] New message on ${order.orderNumber}`,
                paragraphs: [preview],
                link: { label: 'Open the ops queue', href: new URL('/admin/prime', env().APP_URL).toString() },
                idempotencyKey: `chat:${order.id}:ops:${now.getTime()}`,
            });
        }
    }
}

/** Ops acknowledges (or declines) a hold request; the answer is posted in the thread. */
export async function resolveHold(holdId: string, decision: 'acknowledge' | 'decline', note: string | null, actor: Actor): Promise<HoldRequestView> {
    return withTx(async (tx) => {
        const [hold] = await tx.select().from(holdRequests).where(eq(holdRequests.id, holdId)).for('update');
        if (!hold) throw new ApiError('NOT_FOUND', 'Hold request not found');
        if (hold.status !== 'requested') throw new ApiError('CONFLICT', 'This hold request was already answered.');
        const [order] = await tx.select().from(orders).where(eq(orders.id, hold.orderId));
        const status = decision === 'acknowledge' ? 'acknowledged' : 'declined';
        const now = new Date();
        const [updated] = await tx.update(holdRequests).set({ status, note, resolvedBy: `${actor.kind}:${actor.id}`, resolvedAt: now }).where(eq(holdRequests.id, holdId)).returning();
        await tx.insert(orderMessages).values({
            orderId: hold.orderId,
            authorKind: 'ops',
            authorId: actor.id,
            body:
                decision === 'acknowledge'
                    ? `We confirmed the hold with the shop. Production on ${order?.orderNumber ?? 'your order'} is paused until you tell us to continue.${note ? ` ${note}` : ''}`
                    : `We could not hold production on ${order?.orderNumber ?? 'your order'}.${note ? ` ${note}` : ' It is too far along to pause safely.'}`,
            createdAt: now,
        });
        await emitEvent(tx, {
            type: 'hold.resolved',
            payload: { holdId, orderId: hold.orderId, status, note },
            actor,
            correlationId: order?.correlationId ?? hold.orderId,
            buildId: order?.buildId ?? null,
            timestamp: now,
        });
        return toHoldView(updated);
    });
}

export async function listOpenHolds() {
    const db = getDb();
    const rows = await db
        .select({ hold: holdRequests, orderNumber: orders.orderNumber, orderStatus: orders.status, shopName: shops.name })
        .from(holdRequests)
        .innerJoin(orders, eq(orders.id, holdRequests.orderId))
        .leftJoin(shops, eq(shops.id, orders.shopId))
        .where(eq(holdRequests.status, 'requested'))
        .orderBy(asc(holdRequests.createdAt))
        .limit(100);
    return rows.map((r) => ({ ...toHoldView(r.hold), orderNumber: r.orderNumber, orderStatus: r.orderStatus, shopName: r.shopName ?? null }));
}

/** Orders with buyer/shop messages ops have not read (ops chat inbox). */
export async function opsChatInbox(limit = 50) {
    const db = getDb();
    const latest = await db
        .select({ orderId: orderMessages.orderId, at: sql<Date>`max(${orderMessages.createdAt})` })
        .from(orderMessages)
        .groupBy(orderMessages.orderId)
        .orderBy(desc(sql`max(${orderMessages.createdAt})`))
        .limit(limit);
    if (!latest.length) return [];
    const ids = latest.map((l) => l.orderId);
    const unread = await unreadCounts(ids, 'ops');
    const nums = await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(inArray(orders.id, ids));
    const out = [];
    for (const l of latest) {
        const [last] = await db.select({ body: orderMessages.body }).from(orderMessages).where(eq(orderMessages.orderId, l.orderId)).orderBy(desc(orderMessages.createdAt)).limit(1);
        out.push({ orderId: l.orderId, orderNumber: nums.find((n) => n.id === l.orderId)?.orderNumber ?? l.orderId, lastMessageAt: new Date(l.at).toISOString(), unread: unread.get(l.orderId) ?? 0, preview: (last?.body ?? '').slice(0, 140) });
    }
    return out;
}
