/**
 * Server-side checkout previews (display only; checkout re-prices everything):
 * the totals with Prime benefits for members, and for non-members the "Prime members ship
 * this free" offer computed by the same pure benefits function.
 */
import { eq, inArray } from 'drizzle-orm';
import type { ShippingMethod } from '../../contracts/enums';
import type { CheckoutPreviewResponse } from '../../contracts/prime';
import { getDb } from '../db';
import { quotes } from '../db/schema';
import { ApiError } from '../http';
import { applyMembershipBenefits, type MembershipForBenefits } from '../prime/benefits';
import { primeBenefits } from '../prime/membership-config';
import { getMembershipForBenefits, getMembershipRow } from '../prime/membership';
import { findOpenCart, loadCartLines } from './cart';
import { mergeBenefits, priceQuotes, sumTotals } from './checkout';
import type { CartOwner } from './owner';

type QuoteRow = typeof quotes.$inferSelect;

async function previewFor(quoteRows: QuoteRow[], shippingMethod: ShippingMethod, userId: string | null): Promise<CheckoutPreviewResponse> {
    const membership = await getMembershipForBenefits(userId);
    const original = await priceQuotes(quoteRows, shippingMethod, null);
    const priced = membership?.isMember ? await priceQuotes(quoteRows, shippingMethod, membership) : original;
    let primeOffer: CheckoutPreviewResponse['primeOffer'] = null;
    if (!membership?.isMember) {
        const asMember: MembershipForBenefits = { isMember: true, membershipId: null, benefits: primeBenefits() };
        const qualifying = quoteRows.reduce((s, q) => s + q.subtotalCents, 0);
        let savings = 0;
        for (const { quote, priced: p } of original) {
            const standard = quote.shippingOptions.find((o) => o.method === 'STANDARD');
            const r = applyMembershipBenefits({ ...p.totals, lineItems: quote.lineItems, shippingMethod, freight: Boolean(standard && /^freight/i.test(standard.label)), qualifyingSubtotalCents: qualifying }, asMember);
            savings += r.shippingWaivedCents + r.materialDiscountCents;
        }
        const row = userId ? await getMembershipRow(userId) : null;
        primeOffer = { savingsCents: savings, freeShippingThresholdCents: primeBenefits().freeShippingThresholdCents, trialAvailable: !row?.trialUsed };
    }
    return {
        totals: sumTotals(priced.map((l) => l.priced.totals)),
        originalTotals: sumTotals(original.map((l) => l.priced.totals)),
        benefits: mergeBenefits(priced.map((l) => l.priced.benefits)),
        isMember: Boolean(membership?.isMember),
        primeOffer,
    };
}

export async function previewQuote(quoteId: string, shippingMethod: ShippingMethod, userId: string | null): Promise<CheckoutPreviewResponse> {
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (!quote) throw new ApiError('NOT_FOUND', 'Quote not found');
    return previewFor([quote], shippingMethod, userId);
}

export async function previewCart(owner: CartOwner, shippingMethod: ShippingMethod): Promise<CheckoutPreviewResponse> {
    const cart = await findOpenCart(owner);
    const lines = cart ? await loadCartLines(cart.id) : [];
    if (!lines.length) throw new ApiError('CONFLICT', 'Your cart is empty.');
    const rows = await getDb().select().from(quotes).where(inArray(quotes.id, lines.map((l) => l.quote.id)));
    return previewFor(lines.map((l) => rows.find((r) => r.id === l.quote.id)!), shippingMethod, owner.userId);
}
