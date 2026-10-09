/**
 * Build cart: several BINDING quotes (different parts / builds) checked out together.
 *
 * Model: one open cart per owner (user id, or device hash for guests); one item per part
 * (adding a newer quote of the same part replaces the older one). Items reference
 * immutable quote snapshots, so the cart never stores a price: every total is read from
 * the quotes (and, at checkout, re-validated by the same checks as single checkout).
 *
 * Sign-in merge: `mergeGuestCart(userId, deviceHash)` moves the device's open cart into
 * the user's open cart (per part, the most recently added item wins) and marks the guest
 * cart `merged`. It runs lazily on every cart request of a signed-in user (idempotent);
 * the accounts module may also call it right after sign-in.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { CartItemView, CartView, UpsellKind } from '../../contracts/prime';
import { getDb, withTx, type DbOrTx } from '../db';
import { cartItems, carts, parts, quotes } from '../db/schema';
import { ApiError } from '../http';
import { isQuoteOrderable } from '../quote';
import type { CartOwner } from './owner';

export type CartRow = typeof carts.$inferSelect;

function ownerWhere(owner: CartOwner) {
    if (owner.userId) return and(eq(carts.userId, owner.userId), eq(carts.status, 'open'));
    if (owner.deviceHash) return and(isNull(carts.userId), eq(carts.deviceHash, owner.deviceHash), eq(carts.status, 'open'));
    return null;
}

export async function findOpenCart(owner: CartOwner, db: DbOrTx = getDb()): Promise<CartRow | null> {
    const where = ownerWhere(owner);
    if (!where) return null;
    const [row] = await db.select().from(carts).where(where).limit(1);
    return row ?? null;
}

export async function getOrCreateOpenCart(owner: CartOwner, db: DbOrTx = getDb()): Promise<CartRow> {
    const existing = await findOpenCart(owner, db);
    if (existing) return existing;
    if (!owner.userId && !owner.deviceHash) throw new ApiError('BAD_REQUEST', 'No cart owner');
    await db
        .insert(carts)
        .values({ userId: owner.userId, deviceHash: owner.userId ? null : owner.deviceHash, status: 'open' })
        .onConflictDoNothing();
    const created = await findOpenCart(owner, db);
    if (!created) throw new ApiError('INTERNAL', 'Could not create a cart');
    return created;
}

/** Move a device's guest cart into the user's cart. Idempotent; returns the number of items moved. */
export async function mergeGuestCart(userId: string, deviceHash: string): Promise<number> {
    const guest = await findOpenCart({ userId: null, deviceHash });
    if (!guest) return 0;
    return withTx(async (tx) => {
        const [locked] = await tx.select().from(carts).where(and(eq(carts.id, guest.id), eq(carts.status, 'open'))).for('update');
        if (!locked) return 0;
        const target = await getOrCreateOpenCart({ userId, deviceHash: null }, tx);
        const guestItems = await tx.select().from(cartItems).where(eq(cartItems.cartId, guest.id));
        const userItems = await tx.select().from(cartItems).where(eq(cartItems.cartId, target.id));
        const byPart = new Map(userItems.map((i) => [i.partId, i]));
        let moved = 0;
        for (const g of guestItems) {
            const mine = byPart.get(g.partId);
            if (mine && mine.addedAt.getTime() >= g.addedAt.getTime()) continue;
            if (mine) await tx.delete(cartItems).where(eq(cartItems.id, mine.id));
            await tx.update(cartItems).set({ cartId: target.id }).where(eq(cartItems.id, g.id));
            moved++;
        }
        await tx.delete(cartItems).where(eq(cartItems.cartId, guest.id));
        await tx.update(carts).set({ status: 'merged', updatedAt: new Date() }).where(eq(carts.id, guest.id));
        return moved;
    });
}

type QuoteRow = typeof quotes.$inferSelect;

async function loadOrderableQuote(quoteId: string, db: DbOrTx = getDb()): Promise<QuoteRow> {
    const [r] = await db
        .select({ quote: quotes, part: { designVersion: parts.designVersion, rulesetVersion: parts.rulesetVersion } })
        .from(quotes)
        .innerJoin(parts, eq(parts.id, quotes.partId))
        .where(eq(quotes.id, quoteId))
        .limit(1);
    if (!r) throw new ApiError('NOT_FOUND', 'Quote not found');
    if (!isQuoteOrderable(r.quote, r.part)) throw new ApiError('CONFLICT', 'Only current binding quotes can go in the cart. Refresh the quote first.');
    return r.quote;
}

/** Add (or replace) the item for this quote's part. `upsell` swaps in the engine-priced upsell quote. */
export async function addCartItem(owner: CartOwner, quoteId: string, upsell?: UpsellKind): Promise<void> {
    let finalQuoteId = quoteId;
    const applied: UpsellKind[] = [];
    if (upsell) {
        const { getUpsellOffers } = await import('./upsells');
        const offer = (await getUpsellOffers(quoteId)).find((o) => o.kind === upsell);
        if (!offer) throw new ApiError('CONFLICT', 'That add-on is not available for this part.');
        finalQuoteId = offer.offerQuoteId;
        applied.push(upsell);
    }
    const quote = await loadOrderableQuote(finalQuoteId);
    await withTx(async (tx) => {
        const cart = await getOrCreateOpenCart(owner, tx);
        await tx
            .insert(cartItems)
            .values({ cartId: cart.id, quoteId: quote.id, partId: quote.partId, upsells: applied, addedAt: new Date() })
            .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.partId], set: { quoteId: quote.id, upsells: applied, addedAt: new Date() } });
        await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    });
}

export async function removeCartItem(owner: CartOwner, itemId: string): Promise<void> {
    const cart = await findOpenCart(owner);
    if (!cart) throw new ApiError('NOT_FOUND', 'Cart item not found');
    const deleted = await getDb().delete(cartItems).where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id))).returning({ id: cartItems.id });
    if (!deleted.length) throw new ApiError('NOT_FOUND', 'Cart item not found');
}

/** Apply an upsell to an item: the item moves to the upsell's engine quote. */
export async function applyUpsellToItem(owner: CartOwner, itemId: string, kind: UpsellKind): Promise<void> {
    const cart = await findOpenCart(owner);
    if (!cart) throw new ApiError('NOT_FOUND', 'Cart item not found');
    const [item] = await getDb().select().from(cartItems).where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id))).limit(1);
    if (!item) throw new ApiError('NOT_FOUND', 'Cart item not found');
    if (item.upsells.includes(kind)) throw new ApiError('CONFLICT', 'That add-on is already in your cart.');
    const { getUpsellOffers } = await import('./upsells');
    const offer = (await getUpsellOffers(item.quoteId)).find((o) => o.kind === kind);
    if (!offer) throw new ApiError('CONFLICT', 'That add-on is not available for this part.');
    const quote = await loadOrderableQuote(offer.offerQuoteId);
    await getDb()
        .update(cartItems)
        .set({ quoteId: quote.id, upsells: [...item.upsells, kind], addedAt: new Date() })
        .where(eq(cartItems.id, item.id));
}

/** Items with their quote snapshots (checkout uses the same loader). */
export async function loadCartLines(cartId: string, db: DbOrTx = getDb()) {
    return db
        .select({ item: cartItems, quote: quotes, part: { designVersion: parts.designVersion, rulesetVersion: parts.rulesetVersion, preview: parts.preview } })
        .from(cartItems)
        .innerJoin(quotes, eq(quotes.id, cartItems.quoteId))
        .innerJoin(parts, eq(parts.id, cartItems.partId))
        .where(eq(cartItems.cartId, cartId))
        .orderBy(asc(cartItems.addedAt));
}

export async function getCartView(owner: CartOwner, now: Date = new Date()): Promise<CartView> {
    const cart = await findOpenCart(owner);
    const guest = !owner.userId;
    if (!cart) return { id: null, items: [], count: 0, subtotalCents: 0, currency: 'usd', guest };
    const lines = await loadCartLines(cart.id);
    const items: CartItemView[] = lines.map(({ item, quote, part }) => ({
        id: item.id,
        quoteId: quote.id,
        partId: quote.partId,
        buildId: quote.buildId,
        summary: quote.summary,
        preview: part.preview ?? null,
        unitPriceCents: quote.unitPriceCents,
        subtotalCents: quote.subtotalCents,
        currency: quote.currency,
        orderable: isQuoteOrderable(quote, part, now),
        standardShippingCents: quote.shippingOptions.find((o) => o.method === 'STANDARD')?.priceCents ?? null,
        shipDate: quote.shipDate,
        upsells: item.upsells.filter((u): u is UpsellKind => u === 'hardware_kit' || u === 'spare_part' || u === 'finish_upgrade'),
        addedAt: item.addedAt.toISOString(),
    }));
    return {
        id: cart.id,
        items,
        count: items.length,
        subtotalCents: items.reduce((s, i) => s + i.subtotalCents, 0),
        currency: items[0]?.currency ?? 'usd',
        guest,
    };
}

/** Close the cart after checkout (its quotes are now orders). */
export async function closeCart(cartId: string, tx: DbOrTx): Promise<void> {
    await tx.update(carts).set({ status: 'checked_out', updatedAt: new Date() }).where(eq(carts.id, cartId));
}

/** Remove specific quotes from any open cart (e.g. after a single-quote checkout paid for it). */
export async function removeQuotesFromCarts(quoteIds: string[], tx: DbOrTx = getDb()): Promise<void> {
    if (!quoteIds.length) return;
    await tx.delete(cartItems).where(inArray(cartItems.quoteId, quoteIds));
}
