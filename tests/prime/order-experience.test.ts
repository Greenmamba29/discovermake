import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { OrderChatView, OrderRatingResponse, TrackingMapView } from '@/contracts/prime';
import { holdRequests, manufacturingJobs, orders, shops } from '@/server/db/schema';
import { markShipmentDelivered } from '@/server/shipping';
import { createShipment, createShopSession } from '@/server/shops';
import { getStorage } from '@/server/storage';
import { GET as buyerChat, POST as buyerPost } from '@/app/api/orders/[orderId]/messages/route';
import { POST as buyerUpload } from '@/app/api/orders/[orderId]/messages/upload/route';
import { GET as shopChat, POST as shopPost } from '@/app/api/shop/jobs/[jobId]/messages/route';
import { GET as shopFlags } from '@/app/api/shop/flags/route';
import { GET as opsChat } from '@/app/api/admin/prime/orders/[orderId]/messages/route';
import { GET as adminQueue } from '@/app/api/admin/prime/route';
import { POST as resolveHoldRoute } from '@/app/api/admin/prime/holds/[holdId]/route';
import { GET as getRating, POST as postRating } from '@/app/api/orders/[orderId]/rating/route';
import { POST as ratingUpload } from '@/app/api/orders/[orderId]/rating/upload/route';
import { POST as moderate } from '@/app/api/admin/prime/ratings/[ratingId]/route';
import { GET as trackingMap } from '@/app/api/orders/[orderId]/tracking-map/route';
import { useTestDb as withTestDb } from '../support/db';
import { useLocalStorage as withLocalStorage } from '../accounts/fixtures';
import { params, req, signedInUser } from '../accounts/helpers';
import { createAcceptedJob, createPaidOrder, createQaPassedJob, createShopFixture, quietConsole } from '../shop/fixtures';

const ctx = withTestDb({ seed: true });
withLocalStorage();
beforeAll(() => quietConsole());

const ADMIN = { authorization: 'Bearer test-admin-token' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function shopCookie(shopToken: string) {
    const s = await createShopSession(shopToken);
    return { cookie: `dm_shop_session=${s!.sessionSecret}` };
}

async function devShopToken() {
    // The seeded dev shop token is random; issue a fresh console token for the shop that accepted.
    const { issueShopToken } = await import('@/server/shops/admin');
    return async (shopId: string) => (await issueShopToken(shopId, { label: `t${Math.random()}` })).token;
}

async function deliveredJob() {
    const job = await createQaPassedJob(ctx.db);
    const s = await createShipment(job.shopId, job.jobId, { parcel: { lengthIn: 10, widthIn: 8, heightIn: 2, weightOz: 20 }, manual: { carrier: 'UPS', service: 'Ground', trackingNumber: '1Z999AA10123456785' } });
    return { ...job, shipmentId: s.id };
}

describe('order chat authz matrix', () => {
    it('buyer by token or signed-in owner; wrong token 404; other shop 404; assigned shop + ops allowed', async () => {
        const job = await createAcceptedJob(ctx.db);
        const orderId = job.order.id;
        const url = (t?: string) => `/api/orders/${orderId}/messages${t ? `?t=${encodeURIComponent(t)}` : ''}`;

        const ok = await buyerChat(req('GET', url(job.token), null), params({ orderId }));
        expect(ok.status).toBe(200);
        const chat = OrderChatView.parse(await ok.json());
        expect(chat.viewer).toBe('buyer');
        expect(chat.quickReplies.map((q) => q.key)).toEqual(['where_is_my_order', 'approve_change', 'send_photo', 'hold_production']);

        expect((await buyerChat(req('GET', url('dmo_wrongtoken'), null), params({ orderId }))).status).toBe(404);
        expect((await buyerChat(req('GET', url(), null), params({ orderId }))).status).toBe(404);
        expect((await buyerChat(req('GET', url(job.token), null), params({ orderId: 'ord_doesnotexist0000' }))).status).toBe(404);

        // Signed-in owner (verified email = buyer email) needs no token; another user does.
        const owner = await signedInUser('maker@example.com');
        expect((await buyerChat(req('GET', url(), owner), params({ orderId }))).status).toBe(200);
        const stranger = await signedInUser();
        expect((await buyerChat(req('GET', url(), stranger), params({ orderId }))).status).toBe(404);

        const issue = await devShopToken();
        const assigned = await shopCookie(await issue(job.shopId));
        expect((await shopChat(req('GET', `/api/shop/jobs/${job.jobId}/messages`, null, undefined, assigned), params({ jobId: job.jobId }))).status).toBe(200);
        const other = await createShopFixture(ctx.db, { name: 'Other Shop' });
        const otherCookie = await shopCookie(other.token);
        expect((await shopChat(req('GET', `/api/shop/jobs/${job.jobId}/messages`, null, undefined, otherCookie), params({ jobId: job.jobId }))).status).toBe(404);
        expect((await shopChat(req('GET', `/api/shop/jobs/${job.jobId}/messages`, null), params({ jobId: job.jobId }))).status).toBe(401);

        expect((await opsChat(req('GET', `/api/admin/prime/orders/${orderId}/messages`, null, undefined, ADMIN), params({ orderId }))).status).toBe(200);
        expect((await opsChat(req('GET', `/api/admin/prime/orders/${orderId}/messages`, null), params({ orderId }))).status).toBe(401);
    });

    it('"Where is my order?" gets an auto reply; the shop replies and the buyer sees it with unread counts', async () => {
        const job = await createAcceptedJob(ctx.db);
        const orderId = job.order.id;
        const posted = await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, { quickReply: 'where_is_my_order' }), params({ orderId }));
        expect(posted.status).toBe(201);
        const afterPost = OrderChatView.parse(await posted.json());
        expect(afterPost.messages.map((m) => m.authorKind)).toEqual(['buyer', 'system']);
        expect(afterPost.messages[0]).toMatchObject({ body: 'Where is my order?', quickReply: 'where_is_my_order', mine: true });
        expect(afterPost.messages[1].body).toMatch(/Shop accepted/);

        const issue = await devShopToken();
        const cookie = await shopCookie(await issue(job.shopId));
        const flags = await (await shopFlags(req('GET', '/api/shop/flags', null, undefined, cookie), params({}))).json();
        expect(flags.orders[orderId]).toEqual({ priority: false, unread: 2 });
        const reply = await shopPost(req('POST', `/api/shop/jobs/${job.jobId}/messages`, null, { body: 'Cutting tomorrow morning — see https://example.com/schedule' }, cookie), params({ jobId: job.jobId }));
        expect(reply.status).toBe(201);
        const peek = OrderChatView.parse(await (await buyerChat(req('GET', `/api/orders/${orderId}/messages?t=${job.token}&peek=1`, null), params({ orderId }))).json());
        expect(peek.unreadCount).toBe(1);
        const read = OrderChatView.parse(await (await buyerChat(req('GET', `/api/orders/${orderId}/messages?t=${job.token}`, null), params({ orderId }))).json());
        expect(read.messages.at(-1)).toMatchObject({ authorKind: 'shop', authorLabel: expect.any(String), mine: false });
        expect(read.messages.at(-1)!.body).toContain('https://example.com/schedule');

        // Caps and validation.
        expect((await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, { body: 'x'.repeat(2001) }), params({ orderId }))).status).toBe(400);
        expect((await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, {}), params({ orderId }))).status).toBe(400);
    });

    it('attachments are images only (signed upload + magic bytes)', async () => {
        const job = await createAcceptedJob(ctx.db);
        const orderId = job.order.id;
        const up = async () => (await (await buyerUpload(req('POST', `/api/orders/${orderId}/messages/upload?t=${job.token}`, null, { contentType: 'image/png', sizeBytes: PNG.length }), params({ orderId }))).json()).key as string;
        const good = await up();
        expect(good.startsWith(`chat/${orderId}/`)).toBe(true);
        await getStorage().putObject(good, PNG, { contentType: 'image/png' });
        const ok = await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, { attachmentKey: good }), params({ orderId }));
        expect(ok.status).toBe(201);
        expect(OrderChatView.parse(await ok.json()).messages.at(-1)!.attachmentUrl).toMatch(/^http/);

        const fake = await up();
        await getStorage().putObject(fake, new TextEncoder().encode('<script>alert(1)</script>'), { contentType: 'image/png' });
        expect((await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, { attachmentKey: fake }), params({ orderId }))).status).toBe(415);
        expect(await getStorage().headObject(fake)).toBeNull();
        expect((await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, { attachmentKey: `chat/ord_other/x.png` }), params({ orderId }))).status).toBe(400);
        expect((await buyerUpload(req('POST', `/api/orders/${orderId}/messages/upload?t=${job.token}`, null, { contentType: 'application/pdf', sizeBytes: 10 }), params({ orderId }))).status).toBe(400);
    });

    it('"Hold production" creates a request ops must acknowledge; the job keeps running until then', async () => {
        const job = await createAcceptedJob(ctx.db);
        const orderId = job.order.id;
        await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, { quickReply: 'hold_production' }), params({ orderId }));
        const [hold] = await ctx.db.select().from(holdRequests).where(eq(holdRequests.orderId, orderId));
        expect(hold.status).toBe('requested');
        const [jobRow] = await ctx.db.select().from(manufacturingJobs).where(eq(manufacturingJobs.id, job.jobId));
        expect(jobRow.status).toBe('ACCEPTED'); // never silently stopped
        const chat = OrderChatView.parse(await (await buyerChat(req('GET', `/api/orders/${orderId}/messages?t=${job.token}`, null), params({ orderId }))).json());
        expect(chat.hold?.status).toBe('requested');
        expect(chat.quickReplies.map((q) => q.key)).not.toContain('hold_production');
        // A second hold while one is open is refused.
        expect((await buyerPost(req('POST', `/api/orders/${orderId}/messages?t=${job.token}`, null, { quickReply: 'hold_production' }), params({ orderId }))).status).toBe(409);

        const queue = await (await adminQueue(req('GET', '/api/admin/prime', null, undefined, ADMIN), params({}))).json();
        expect(queue.holds.map((h: { id: string }) => h.id)).toContain(hold.id);
        const resolved = await resolveHoldRoute(req('POST', `/api/admin/prime/holds/${hold.id}`, null, { decision: 'acknowledge' }, ADMIN), params({ holdId: hold.id }));
        expect(resolved.status).toBe(200);
        expect((await resolved.json()).status).toBe('acknowledged');
        const after = OrderChatView.parse(await (await buyerChat(req('GET', `/api/orders/${orderId}/messages?t=${job.token}`, null), params({ orderId }))).json());
        expect(after.messages.at(-1)).toMatchObject({ authorKind: 'ops' });
        expect((await resolveHoldRoute(req('POST', `/api/admin/prime/holds/${hold.id}`, null, { decision: 'decline' }, ADMIN), params({ holdId: hold.id }))).status).toBe(409);

        // Shipped orders cannot be held.
        const paid = await createPaidOrder(ctx.db);
        await ctx.db.update(orders).set({ status: 'SHIPPED' }).where(eq(orders.id, paid.order.id));
        expect((await buyerPost(req('POST', `/api/orders/${paid.order.id}/messages?t=${paid.token}`, null, { quickReply: 'hold_production' }), params({ orderId: paid.order.id }))).status).toBe(409);
    });
});

describe('rating + UGC', () => {
    it('only delivered orders, once per order, pending until ops approve; approval updates the shop rating', async () => {
        const job = await deliveredJob();
        const orderId = job.order.id;
        const before = OrderRatingResponse.parse(await (await getRating(req('GET', `/api/orders/${orderId}/rating?t=${job.token}`, null), params({ orderId }))).json());
        expect(before.eligible).toBe(false);
        expect(before.reason).toMatch(/once it is delivered/);
        expect((await postRating(req('POST', `/api/orders/${orderId}/rating?t=${job.token}`, null, { stars: 5 }), params({ orderId }))).status).toBe(409);
        expect((await ratingUpload(req('POST', `/api/orders/${orderId}/rating/upload?t=${job.token}`, null, { contentType: 'image/png', sizeBytes: 100 }), params({ orderId }))).status).toBe(409);

        await markShipmentDelivered(job.shipmentId, { kind: 'admin', id: 'ops' });
        const up = await (await ratingUpload(req('POST', `/api/orders/${orderId}/rating/upload?t=${job.token}`, null, { contentType: 'image/png', sizeBytes: PNG.length }), params({ orderId }))).json();
        await getStorage().putObject(up.key, PNG, { contentType: 'image/png' });
        const submitted = await postRating(req('POST', `/api/orders/${orderId}/rating?t=${job.token}`, null, { stars: 4, tags: ['quality', 'fit'], caption: 'Fits my robot arm', photoKey: up.key }), params({ orderId }));
        expect(submitted.status).toBe(201);
        const r = OrderRatingResponse.parse(await submitted.json());
        expect(r.rating).toMatchObject({ stars: 4, tags: ['quality', 'fit'], status: 'pending', caption: 'Fits my robot arm' });
        expect(r.rating?.photoUrl).toMatch(/^http/);
        expect((await postRating(req('POST', `/api/orders/${orderId}/rating?t=${job.token}`, null, { stars: 1 }), params({ orderId }))).status).toBe(409);
        expect((await postRating(req('POST', `/api/orders/${orderId}/rating?t=dmo_nope`, null, { stars: 1 }), params({ orderId }))).status).toBe(404);
        expect((await postRating(req('POST', `/api/orders/${orderId}/rating?t=${job.token}`, null, { stars: 6 }), params({ orderId }))).status).toBe(400);

        const [shopBefore] = await ctx.db.select().from(shops).where(eq(shops.id, job.shopId));
        const queue = await (await adminQueue(req('GET', '/api/admin/prime', null, undefined, ADMIN), params({}))).json();
        const item = queue.ratings.find((x: { orderId: string }) => x.orderId === orderId);
        expect(item).toMatchObject({ status: 'pending', stars: 4 });
        expect((await moderate(req('POST', `/api/admin/prime/ratings/${item.id}`, null, { decision: 'approve' }), params({ ratingId: item.id }))).status).toBe(401);
        const approved = await moderate(req('POST', `/api/admin/prime/ratings/${item.id}`, null, { decision: 'approve' }, ADMIN), params({ ratingId: item.id }));
        expect((await approved.json()).status).toBe('approved');
        const [shopAfter] = await ctx.db.select().from(shops).where(eq(shops.id, job.shopId));
        expect(shopAfter.ratingCount).toBe(shopBefore.ratingCount + 1);
        expect(shopAfter.rating).not.toBeNull();
        expect((await moderate(req('POST', `/api/admin/prime/ratings/${item.id}`, null, { decision: 'reject' }, ADMIN), params({ ratingId: item.id }))).status).toBe(409);

        // A rejected rating never counts toward the shop's rating.
        const job2 = await deliveredJob();
        await markShipmentDelivered(job2.shipmentId, { kind: 'admin', id: 'ops' });
        await postRating(req('POST', `/api/orders/${job2.order.id}/rating?t=${job2.token}`, null, { stars: 1 }), params({ orderId: job2.order.id }));
        const q2 = await (await adminQueue(req('GET', '/api/admin/prime', null, undefined, ADMIN), params({}))).json();
        const item2 = q2.ratings.find((x: { orderId: string }) => x.orderId === job2.order.id);
        await moderate(req('POST', `/api/admin/prime/ratings/${item2.id}`, null, { decision: 'reject', reason: 'Off topic' }, ADMIN), params({ ratingId: item2.id }));
        const [shopFinal] = await ctx.db.select().from(shops).where(eq(shops.id, job2.shopId));
        if (job2.shopId === job.shopId) expect(shopFinal.ratingCount).toBe(shopAfter.ratingCount);
    });
});

describe('tracking map', () => {
    it('serves the route, carrier card and one status sentence once shipped (offline: no style URL)', async () => {
        const job = await deliveredJob();
        const orderId = job.order.id;
        const res = await trackingMap(req('GET', `/api/orders/${orderId}/tracking-map?t=${job.token}`, null), params({ orderId }));
        expect(res.status).toBe(200);
        const map = TrackingMapView.parse(await res.json());
        expect(map.from.label).toMatch(/, (PA|NJ)$/);
        expect(map.to.label).toBe('Philadelphia, PA');
        expect(map.path.length).toBe(65);
        expect(map.carrier).toMatchObject({ carrier: 'UPS', trackingNumber: '1Z999AA10123456785' });
        expect(map.styleUrl).toBeNull();
        expect(map.statusSentence.length).toBeGreaterThan(5);
        expect((await trackingMap(req('GET', `/api/orders/${orderId}/tracking-map?t=dmo_bad`, null), params({ orderId }))).status).toBe(404);

        const notShipped = await createPaidOrder(ctx.db);
        expect((await trackingMap(req('GET', `/api/orders/${notShipped.order.id}/tracking-map?t=${notShipped.token}`, null), params({ orderId: notShipped.order.id }))).status).toBe(404);
    });
});
