import { eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CartCheckoutResponse, CartView, CheckoutPreviewResponse, UpsellsResponse } from '@/contracts/prime';
import { cartCheckouts, carts, domainEvents, orders, payments, quotes } from '@/server/db/schema';
import { getCartView, mergeGuestCart } from '@/server/cart/cart';
import { matchHardware } from '@/server/cart/upsells';
import { confirmDevPayment } from '@/server/orders';
import { createQuote, getQuote } from '@/server/quote';
import { startMembership } from '@/server/prime/membership';
import { GET as getCart } from '@/app/api/me/cart/route';
import { POST as addItem } from '@/app/api/me/cart/items/route';
import { POST as applyUpsell } from '@/app/api/me/cart/items/[itemId]/upsell/route';
import { GET as getUpsells } from '@/app/api/me/cart/upsells/route';
import { POST as previewRoute } from '@/app/api/me/cart/preview/route';
import { POST as checkoutRoute } from '@/app/api/me/cart/checkout/route';
import { GET as groupRoute } from '@/app/api/me/cart/checkouts/[checkoutId]/route';
import { useTestDb as withTestDb } from '../support/db';
import { quietConsole } from '../orders/fixtures';
import { AL_6061, analyzedPart, useLocalStorage as withLocalStorage } from '../accounts/fixtures';
import { newDevice, params, req, setCookieValue, signedInUser } from '../accounts/helpers';

const { dispatched } = vi.hoisted(() => ({ dispatched: [] as string[] }));
vi.mock('@/server/dispatch', async (orig) => ({ ...(await orig<typeof import('@/server/dispatch')>()), dispatchOrder: async (id: string) => (dispatched.push(id), null), expireStaleOffers: async () => 0 }));

const ctx = withTestDb({ seed: true });
withLocalStorage();
beforeAll(() => quietConsole());

const ADDRESS = { name: 'Ada Maker', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' };

async function bindingQuote(quantity = 10) {
    const { partId } = await analyzedPart();
    const q = await createQuote({ partId, ...AL_6061, quantity });
    expect(q.orderable).toBe(true);
    return q;
}

describe('build cart', () => {
    it('keeps a guest cart per device and merges it into the user cart on sign-in', async () => {
        const guest = newDevice();
        const q1 = await bindingQuote();
        const add = await addItem(req('POST', '/api/me/cart/items', guest, { quoteId: q1.id }), params({}));
        expect(add.status).toBe(201);
        expect(CartView.parse(await add.json())).toMatchObject({ count: 1, guest: true });

        // A browser without a device cookie gets one minted when it adds to the cart.
        const fresh = await addItem(req('POST', '/api/me/cart/items', null, { quoteId: q1.id }), params({}));
        expect(setCookieValue(fresh, 'dm_device')).toMatch(/^[A-Za-z0-9_-]{32,}$/);

        const user = await signedInUser();
        const q2 = await bindingQuote(5);
        await addItem(req('POST', '/api/me/cart/items', user, { quoteId: q2.id }), params({}));
        // Same browser signs in: the device cart merges into the user's cart.
        const merged = CartView.parse(await (await getCart(req('GET', '/api/me/cart', { ...user, device: guest.device, deviceHash: guest.deviceHash }), params({}))).json());
        expect(merged.guest).toBe(false);
        expect(merged.items.map((i) => i.quoteId).sort()).toEqual([q1.id, q2.id].sort());
        const [guestCart] = await ctx.db.select().from(carts).where(eq(carts.deviceHash, guest.deviceHash));
        expect(guestCart.status).toBe('merged');
        expect(await mergeGuestCart(user.userId!, guest.deviceHash)).toBe(0); // idempotent
        expect((await getCartView({ userId: null, deviceHash: guest.deviceHash })).count).toBe(0);
    });

    it('rejects non-binding quotes and replaces the quote of the same part', async () => {
        const device = newDevice();
        const q = await bindingQuote(10);
        const q11 = await createQuote({ partId: q.partId, ...AL_6061, quantity: 11 });
        await addItem(req('POST', '/api/me/cart/items', device, { quoteId: q.id }), params({}));
        const view = CartView.parse(await (await addItem(req('POST', '/api/me/cart/items', device, { quoteId: q11.id }), params({}))).json());
        expect(view.items).toHaveLength(1);
        expect(view.items[0].quoteId).toBe(q11.id);
        await ctx.db.update(quotes).set({ status: 'REVIEW', trustLevel: 'SUPPLIER_ESTIMATE' }).where(eq(quotes.id, q.id));
        expect((await addItem(req('POST', '/api/me/cart/items', device, { quoteId: q.id }), params({}))).status).toBe(409);
    });
});

describe('Complete your build upsells', () => {
    it('matches fastener sizes to clearance holes', () => {
        const hole = (d: number, circular = true) => ({ center: [0, 0] as [number, number], diameterMm: d, circular, edgeDistanceMm: 5 });
        expect(matchHardware([hole(6.5), hole(6.5), hole(6.5), hole(6.5), hole(30)])).toEqual({ size: 'M6', count: 4 });
        expect(matchHardware([hole(3.4), hole(4.5), hole(4.5)])).toEqual({ size: 'M4', count: 2 });
        expect(matchHardware([hole(30), hole(6.5, false)])).toBeNull();
    });

    it('prices every upsell with the quote engine, and the cart swaps in that exact quote', async () => {
        const base = await bindingQuote(10);
        const res = UpsellsResponse.parse(await (await getUpsells(req('GET', `/api/me/cart/upsells?quoteId=${base.id}`, null), params({}))).json());
        expect(res.offers.map((o) => o.kind).sort()).toEqual(['finish_upgrade', 'hardware_kit', 'spare_part']);
        for (const offer of res.offers) {
            const engine = (await getQuote(offer.offerQuoteId))!;
            expect(engine.orderable).toBe(true);
            expect(offer.offerSubtotalCents).toBe(engine.subtotalCents);
            expect(offer.deltaCents).toBe(engine.subtotalCents - base.subtotalCents);
        }
        const spare = res.offers.find((o) => o.kind === 'spare_part')!;
        const spareQuote = (await getQuote(spare.offerQuoteId))!;
        expect(spareQuote.config.quantity).toBe(11);
        // Independently re-quoting the same config gives the same price (engine is deterministic).
        const direct = await createQuote({ ...spareQuote.config });
        expect(direct.subtotalCents).toBe(spare.offerSubtotalCents);

        const kit = res.offers.find((o) => o.kind === 'hardware_kit')!;
        const kitQuote = (await getQuote(kit.offerQuoteId))!;
        expect(kitQuote.config.services).toEqual([{ serviceId: 'svc_hardware_kit', featureCount: 4, options: { size: 'M6' } }]);
        const finish = (await getQuote(res.offers.find((o) => o.kind === 'finish_upgrade')!.offerQuoteId))!;
        expect(finish.config.finishServiceId).toBe('svc_powder_black_matte');

        // Offers are computed once per base quote.
        const again = UpsellsResponse.parse(await (await getUpsells(req('GET', `/api/me/cart/upsells?quoteId=${base.id}`, null), params({}))).json());
        expect(again.offers.map((o) => o.offerQuoteId).sort()).toEqual(res.offers.map((o) => o.offerQuoteId).sort());

        const device = newDevice();
        const view = CartView.parse(await (await addItem(req('POST', '/api/me/cart/items', device, { quoteId: base.id }), params({}))).json());
        const upsold = CartView.parse(await (await applyUpsell(req('POST', `/api/me/cart/items/${view.items[0].id}/upsell`, device, { kind: 'hardware_kit' }), params({ itemId: view.items[0].id }))).json());
        expect(upsold.items[0]).toMatchObject({ quoteId: kit.offerQuoteId, subtotalCents: kit.offerSubtotalCents, upsells: ['hardware_kit'] });
    });
});

describe('printed (R6) quotes', () => {
    it('go in the cart as normal binding quotes and get no sheet-metal upsells', async () => {
        const q = await bindingQuote(4);
        await ctx.db.update(quotes).set({ config: { ...q.config, process: 'print' } }).where(eq(quotes.id, q.id));
        const offers = UpsellsResponse.parse(await (await getUpsells(req('GET', `/api/me/cart/upsells?quoteId=${q.id}`, null), params({}))).json());
        expect(offers.offers).toEqual([]);
        const device = newDevice();
        const view = CartView.parse(await (await addItem(req('POST', '/api/me/cart/items', device, { quoteId: q.id }), params({}))).json());
        expect(view.items[0]).toMatchObject({ quoteId: q.id, orderable: true });
    });
});

describe('cart checkout', () => {
    it('charges once for every part: totals == sum of server quotes + Prime benefits, one order per part', async () => {
        const user = await signedInUser();
        await startMembership({ id: user.userId!, email: user.email! }, 'monthly');
        const q1 = await bindingQuote(10);
        const q2 = await bindingQuote(25);
        for (const q of [q1, q2]) await addItem(req('POST', '/api/me/cart/items', user, { quoteId: q.id }), params({}));

        const preview = CheckoutPreviewResponse.parse(await (await previewRoute(req('POST', '/api/me/cart/preview', user, { shippingMethod: 'STANDARD' }), params({}))).json());
        expect(preview.isMember).toBe(true);
        expect(preview.originalTotals.subtotalCents).toBe(q1.subtotalCents + q2.subtotalCents);
        const std = (q: typeof q1) => q.shippingOptions.find((o) => o.method === 'STANDARD')!.priceCents;
        expect(preview.originalTotals.shippingCents).toBe(std(q1) + std(q2));

        const body = { shippingMethod: 'STANDARD', buyer: { email: user.email, name: 'Ada Maker' }, shippingAddress: ADDRESS, acceptTerms: true, payment: { mode: 'card' } };
        const res = await checkoutRoute(req('POST', '/api/me/cart/checkout', user, body), params({}));
        expect(res.status).toBe(201);
        const out = CartCheckoutResponse.parse(await res.json());
        expect(out.orders).toHaveLength(2);
        expect(out.totals).toEqual(preview.totals);
        const discount = out.benefits.find((b) => b.code === 'MATERIAL_DISCOUNT')?.savingsCents ?? 0;
        const waived = out.benefits.find((b) => b.code === 'FREE_SHIPPING')?.savingsCents ?? 0;
        expect(out.totals.totalCents).toBe(q1.subtotalCents + q2.subtotalCents + std(q1) + std(q2) - discount - waived);
        expect(out.totals.totalCents).toBe(out.orders.reduce((s, o) => s + o.totals.totalCents, 0));

        const rows = await ctx.db.select().from(orders).where(inArray(orders.id, out.orders.map((o) => o.orderId)));
        expect(rows.every((o) => o.status === 'PENDING_PAYMENT' && o.buyerUserId === user.userId)).toBe(true);
        const [group] = await ctx.db.select().from(cartCheckouts).where(eq(cartCheckouts.id, out.checkoutId));
        expect(group.amountCents).toBe(out.totals.totalCents);
        const pays = await ctx.db.select().from(payments).where(inArray(payments.orderId, group.orderIds));
        expect(pays.map((p) => p.providerRef).sort()).toEqual([`${group.providerRef}#1`, `${group.providerRef}#2`]);
        expect((await getCartView({ userId: user.userId!, deviceHash: null })).count).toBe(0);

        // One dev payment for the group pays both orders through the shared webhook pipeline.
        const confirmed = await confirmDevPayment(JSON.stringify({ providerRef: group.providerRef, outcome: 'succeeded' }), new Headers());
        expect(confirmed.redirectUrl).toContain(`/cart/done/${group.id}?t=`);
        const paid = await ctx.db.select().from(orders).where(inArray(orders.id, group.orderIds));
        expect(paid.map((o) => o.status)).toEqual(['PAID', 'PAID']);
        expect(dispatched).toEqual(expect.arrayContaining(group.orderIds));
        const checkedOut = await ctx.db.select().from(domainEvents).where(eq(domainEvents.eventType, 'cart.checked_out'));
        expect(checkedOut.some((e) => (e.payload as { checkoutId: string }).checkoutId === group.id)).toBe(true);
        // Replay is a no-op.
        await confirmDevPayment(JSON.stringify({ providerRef: group.providerRef, outcome: 'succeeded' }), new Headers());

        // Signed confirmation page: right token only.
        const token = new URL(out.confirmationUrl).searchParams.get('t')!;
        const ok = await groupRoute(req('GET', `/api/me/cart/checkouts/${group.id}?t=${token}`, null), params({ checkoutId: group.id }));
        expect(ok.status).toBe(200);
        expect((await ok.json()).orders).toHaveLength(2);
        expect((await groupRoute(req('GET', `/api/me/cart/checkouts/${group.id}?t=dmo_wrong`, null), params({ checkoutId: group.id }))).status).toBe(404);
    });

    it('refuses an empty cart', async () => {
        const res = await checkoutRoute(req('POST', '/api/me/cart/checkout', newDevice(), { shippingMethod: 'STANDARD', buyer: { email: 'a@example.com', name: 'A' }, shippingAddress: ADDRESS, acceptTerms: true }), params({}));
        expect(res.status).toBe(409);
    });
});
