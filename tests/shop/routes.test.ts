import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminDispatchResponse, AdminOrderDetail, AdminOrderListResponse } from '@/contracts/admin';
import { PassportPublicView, PassportVerifyResponse } from '@/contracts/passport';
import { ShopJobDetail, ShopJobListResponse, ShopSessionResponse } from '@/contracts/shop';
import { ShipmentView } from '@/contracts/shipments';
import { shopSessions } from '@/server/db/schema';
import { POST as adminCreateShop } from '@/app/api/admin/shops/route';
import { GET as adminListOrders } from '@/app/api/admin/orders/route';
import { GET as adminGetOrder } from '@/app/api/admin/orders/[orderId]/route';
import { POST as adminDispatch } from '@/app/api/admin/orders/[orderId]/dispatch/route';
import { POST as adminOrderDelivered } from '@/app/api/admin/orders/[orderId]/delivered/route';
import { POST as adminExpire } from '@/app/api/admin/offers/expire/route';
import { GET as passportGet } from '@/app/api/passport/[passportId]/route';
import { GET as passportVerify } from '@/app/api/passport/[passportId]/verify/route';
import { DELETE as logout, GET as whoami, POST as login } from '@/app/api/shop/session/route';
import { GET as listJobsRoute } from '@/app/api/shop/jobs/route';
import { GET as jobRoute } from '@/app/api/shop/jobs/[jobId]/route';
import { POST as acceptRoute } from '@/app/api/shop/jobs/[jobId]/accept/route';
import { POST as milestoneRoute } from '@/app/api/shop/jobs/[jobId]/milestones/route';
import { POST as uploadRoute } from '@/app/api/shop/jobs/[jobId]/uploads/route';
import { POST as inspectionRoute } from '@/app/api/shop/jobs/[jobId]/inspection/route';
import { POST as shipmentRoute } from '@/app/api/shop/jobs/[jobId]/shipment/route';
import { getStorage } from '@/server/storage';
import { useTestDb } from '../support/db';
import { createPaidOrder, measurementsFor, quietConsole } from './fixtures';

const BASE = 'http://localhost:3100';
const ADMIN = { authorization: 'Bearer test-admin-token' };
const params = <P>(p: P) => ({ params: Promise.resolve(p) });

function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return new Request(`${BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
}

function sessionCookie(res: Response): string {
    const set = res.headers.get('set-cookie') ?? '';
    const m = /dm_shop_session=([^;]+)/.exec(set);
    if (!m) throw new Error(`no session cookie in ${set}`);
    return `dm_shop_session=${m[1]}`;
}

describe('shop + admin + passport routes', () => {
    const ctx = useTestDb({ seed: { shopToken: 'dmshop_test_token_for_routes_0123456789' } });
    beforeAll(() => quietConsole());

    it('admin routes require the bearer token', async () => {
        expect((await adminListOrders(req('/api/admin/orders'), params({}))).status).toBe(401);
        expect((await adminListOrders(req('/api/admin/orders', { headers: { authorization: 'Bearer nope' } }), params({}))).status).toBe(401);
        expect((await adminExpire(req('/api/admin/offers/expire', { method: 'POST', headers: ADMIN }), params({}))).status).toBe(200);
    });

    it('rejects bad tokens and unauthenticated console calls', async () => {
        const bad = await login(req('/api/shop/session', { method: 'POST', body: { token: 'dmshop_this_is_not_a_real_token_000' } }), params({}));
        expect(bad.status).toBe(401);
        expect((await whoami(req('/api/shop/session'), params({}))).status).toBe(401);
        expect((await listJobsRoute(req('/api/shop/jobs'), params({}))).status).toBe(401);
        const xorigin = await login(req('/api/shop/session', { method: 'POST', body: { token: 'dmshop_test_token_for_routes_0123456789' }, headers: { origin: 'https://evil.example' } }), params({}));
        expect(xorigin.status).toBe(403);
    });

    it('runs a job through the console API with an httpOnly session cookie, then ops delivers it', async () => {
        const res = await login(req('/api/shop/session', { method: 'POST', body: { token: 'dmshop_test_token_for_routes_0123456789' } }), params({}));
        expect(res.status).toBe(200);
        const set = res.headers.get('set-cookie') ?? '';
        expect(set).toMatch(/HttpOnly/i);
        expect(set).toMatch(/SameSite=lax/i);
        expect(set).toMatch(/Path=\//);
        const session = ShopSessionResponse.parse(await res.json());
        expect(session.shop.shopId).toBe('shop_philadelphia_precision');
        const cookie = sessionCookie(res);
        const auth = { cookie };
        expect(ShopSessionResponse.parse(await (await whoami(req('/api/shop/session', { headers: auth }), params({}))).json()).shop.name).toBe('Philadelphia Precision Works');

        const { order } = await createPaidOrder(ctx.db);
        const dispatched = AdminDispatchResponse.parse(await (await adminDispatch(req(`/api/admin/orders/${order.id}/dispatch`, { method: 'POST', headers: ADMIN }), params({ orderId: order.id }))).json());
        expect(dispatched.status).toBe('DISPATCHED');
        const jobId = dispatched.jobId!;

        const inbox = ShopJobListResponse.parse(await (await listJobsRoute(req('/api/shop/jobs?status=OFFERED', { headers: auth }), params({}))).json());
        expect(inbox.jobs.map((j) => j.id)).toContain(jobId);
        expect((await listJobsRoute(req('/api/shop/jobs?status=BOGUS', { headers: auth }), params({}))).status).toBe(400);

        const accepted = ShopJobDetail.parse(await (await acceptRoute(req(`/api/shop/jobs/${jobId}/accept`, { method: 'POST', headers: auth }), params({ jobId }))).json());
        expect(accepted.status).toBe('ACCEPTED');
        const ms = await milestoneRoute(req(`/api/shop/jobs/${jobId}/milestones`, { method: 'POST', headers: auth, body: { kind: 'CUTTING' } }), params({ jobId }));
        expect(ms.status).toBe(201);
        expect((await milestoneRoute(req(`/api/shop/jobs/${jobId}/milestones`, { method: 'POST', headers: auth, body: { kind: 'WELDING' } }), params({ jobId }))).status).toBe(400);

        const up = await uploadRoute(req(`/api/shop/jobs/${jobId}/uploads`, { method: 'POST', headers: auth, body: { filename: 'qa.jpg', contentType: 'image/jpeg', sizeBytes: 4 } }), params({ jobId }));
        expect(up.status).toBe(201);
        const { key } = (await up.json()) as { key: string };
        await getStorage().putObject(key, new Uint8Array([1, 2, 3, 4]), { contentType: 'image/jpeg' });

        const insp = await inspectionRoute(
            req(`/api/shop/jobs/${jobId}/inspection`, { method: 'POST', headers: auth, body: { measurements: await measurementsFor(ctx.db, jobId), photoKeys: [key], inspectorName: 'Pat' } }),
            params({ jobId }),
        );
        expect(insp.status).toBe(201);
        expect(((await insp.json()) as { outcome: string }).outcome).toBe('PASS');

        const ship = await shipmentRoute(
            req(`/api/shop/jobs/${jobId}/shipment`, { method: 'POST', headers: auth, body: { parcel: { lengthIn: 10, widthIn: 8, heightIn: 2, weightOz: 20 }, manual: { carrier: 'UPS', service: 'Ground', trackingNumber: '1ZROUTES00001' } } }),
            params({ jobId }),
        );
        expect(ship.status).toBe(201);
        ShipmentView.parse(await ship.json());

        // Ops confirms delivery (manual carrier) -> COMPLETE + passport.
        const delivered = await adminOrderDelivered(req(`/api/admin/orders/${order.id}/delivered`, { method: 'POST', headers: ADMIN, body: {} }), params({ orderId: order.id }));
        expect(delivered.status).toBe(200);
        const detail = AdminOrderDetail.parse(await (await adminGetOrder(req(`/api/admin/orders/${order.id}`, { headers: ADMIN }), params({ orderId: order.id }))).json());
        expect(detail.status).toBe('COMPLETE');
        expect(detail.universalStatus).toBe('COMPLETE');
        expect(detail.payouts).toHaveLength(1);
        expect(detail.ledger.some((l) => l.txnKey.startsWith('payout:'))).toBe(true);
        const list = AdminOrderListResponse.parse(await (await adminListOrders(req('/api/admin/orders?status=COMPLETE', { headers: ADMIN }), params({}))).json());
        expect(list.orders.map((o) => o.id)).toContain(order.id);
        expect(list.orders.find((o) => o.id === order.id)?.shopName).toBe('Philadelphia Precision Works');

        // Public passport + verify endpoints.
        const finalJob = ShopJobDetail.parse(await (await jobRoute(req(`/api/shop/jobs/${jobId}`, { headers: auth }), params({ jobId }))).json());
        expect(finalJob.status).toBe('DELIVERED');
        const { passports } = await import('@/server/db/schema');
        const [pp] = await ctx.db.select().from(passports).where(eq(passports.orderId, order.id));
        const pres = await passportGet(req(`/api/passport/${pp.id}`), params({ passportId: pp.id }));
        const pjson = (await pres.json()) as Record<string, unknown>;
        expect(PassportPublicView.parse(pjson).verified).toBe(true);
        expect(String(pjson.qrCodeDataUrl)).toMatch(/^data:image\/png;base64,/);
        const vres = PassportVerifyResponse.parse(await (await passportVerify(req(`/api/passport/${pp.id}/verify`), params({ passportId: pp.id }))).json());
        expect(vres.valid).toBe(true);
        expect((await passportGet(req('/api/passport/pps_doesnotexist000000000'), params({ passportId: 'pps_doesnotexist000000000' }))).status).toBe(404);

        // Logout revokes the session server-side.
        const out = await logout(req('/api/shop/session', { method: 'DELETE', headers: auth }), params({}));
        expect(out.status).toBe(200);
        expect(out.headers.get('set-cookie')).toMatch(/dm_shop_session=;/);
        expect((await whoami(req('/api/shop/session', { headers: auth }), params({}))).status).toBe(401);
        const revoked = await ctx.db.select().from(shopSessions);
        expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('admin onboards a shop whose one-time token logs into an isolated console', async () => {
        const create = await adminCreateShop(
            req('/api/admin/shops', {
                method: 'POST',
                headers: ADMIN,
                body: {
                    name: 'Brooklyn Laser Lab',
                    contactEmail: 'ops@brooklynlaser.example',
                    address: { name: 'Brooklyn Laser Lab', line1: '55 Water St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' },
                    rateCard: {
                        fiberLaserCentsPerHour: 14000,
                        co2LaserCentsPerHour: 8000,
                        brakeCentsPerBend: 300,
                        brakeSetupCents: 2500,
                        orderSetupCents: 1500,
                        partHandlingCents: 60,
                        finishingCentsPerFt2: 400,
                        finishBatchSetupCents: 3000,
                        packagingBaseCents: 500,
                        platformMarginPct: 0.3,
                        minimumOrderCents: 2900,
                    },
                    capabilities: [{ thicknessOptionId: 'thk_al5052_063', processId: 'prc_fiber_laser', bedWidthMm: 1500, bedHeightMm: 3000, machineLabel: 'Trumpf 3030' }],
                },
            }),
            params({}),
        );
        expect(create.status).toBe(201);
        const created = (await create.json()) as { shop: { id: string }; consoleToken: { token: string }; capabilityCount: number; rateCardId: string };
        expect(created.capabilityCount).toBe(1);
        expect(created.rateCardId).toMatch(/^rc_/);
        expect(created.consoleToken.token).toMatch(/^dmshop_/);
        const { shopAccessTokens } = await import('@/server/db/schema');
        const stored = await ctx.db.select().from(shopAccessTokens).where(eq(shopAccessTokens.shopId, created.shop.id));
        expect(stored[0].tokenHash).not.toContain(created.consoleToken.token);

        const res = await login(req('/api/shop/session', { method: 'POST', body: { token: created.consoleToken.token } }), params({}));
        expect(res.status).toBe(200);
        const cookie = sessionCookie(res);
        const jobs = ShopJobListResponse.parse(await (await listJobsRoute(req('/api/shop/jobs?status=OFFERED,ACCEPTED,DELIVERED', { headers: { cookie } }), params({}))).json());
        expect(jobs.jobs).toEqual([]);

        // Unknown catalog ids are rejected.
        const bad = await adminCreateShop(
            req('/api/admin/shops', {
                method: 'POST',
                headers: ADMIN,
                body: {
                    name: 'Bad Catalog Co',
                    contactEmail: 'x@bad.example',
                    address: { name: 'X', line1: '1 St', city: 'Newark', region: 'NJ', postalCode: '07102', country: 'US' },
                    capabilities: [{ thicknessOptionId: 'thk_nope', processId: 'prc_fiber_laser', bedWidthMm: 10, bedHeightMm: 10 }],
                },
            }),
            params({}),
        );
        expect(bad.status).toBe(400);
    });
});
