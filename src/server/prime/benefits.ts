/**
 * Prime benefits at checkout: ONE pure function, called from one place in checkout
 * (`priceOrderForCheckout` in src/server/orders/checkout.ts), so merges with the
 * Prime-core work (deposits, promise credits) stay small. No I/O.
 *
 * Math (all integer cents):
 *   - Free standard shipping: member AND method STANDARD AND not freight AND the qualifying
 *     subtotal (the order, or the whole cart) >= threshold  →  shipping = 0.
 *     The platform absorbs the label (ledger: SHIPPING_PAYABLE simply records 0).
 *   - Pooled material pricing: pct% off the MATERIAL line items, never below cost:
 *       raw      = floor(material × pct / 100)
 *       costFloor = ceil(material × shopCost / subtotal)     (the shop's share of the line)
 *       discount = min(raw, material − costFloor, platformFee)
 *     The discount comes out of the platform fee only, so `shopCost` (what the shop is paid)
 *     never changes and `shopCost + platformFee = subtotal` still holds. No discount when a
 *     MINIMUM_ORDER line applies (the minimum is the floor).
 *   - Priority queue + guaranteed-date eligibility are flags on the order (order_benefits).
 *   - Not a member (null, past_due, canceled, incomplete): totals come back unchanged.
 */
import type { AppliedBenefit, PrimeBenefits } from '../../contracts/prime';
import type { QuoteLineItem } from '../../contracts/quotes';
import type { ShippingMethod } from '../../contracts/enums';

/** Same shape as CheckoutPricing (src/server/orders/checkout.ts). */
export type BenefitPricing = {
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    shopCostCents: number;
    platformFeeCents: number;
    currency: string;
};

export type BenefitTotalsInput = BenefitPricing & {
    lineItems: readonly QuoteLineItem[];
    shippingMethod: ShippingMethod;
    /** The STANDARD option of this quote is LTL freight (never free). */
    freight?: boolean;
    /** Subtotal compared with the free-shipping threshold; the cart passes the cart subtotal. Default: this order's subtotal. */
    qualifyingSubtotalCents?: number;
};

export type MembershipForBenefits = {
    isMember: boolean;
    membershipId: string | null;
    benefits: PrimeBenefits;
} | null;

export type BenefitResult<T extends BenefitPricing> = {
    totals: T;
    benefits: AppliedBenefit[];
    flags: { priority: boolean; guaranteedDates: boolean; membershipId: string | null };
    shippingWaivedCents: number;
    materialDiscountCents: number;
};

/** Max material discount for these totals (pure; exported for tests and the paywall). */
export function materialDiscountCents(input: Pick<BenefitTotalsInput, 'lineItems' | 'subtotalCents' | 'shopCostCents' | 'platformFeeCents'>, pct: number): number {
    if (!(pct > 0) || input.subtotalCents <= 0) return 0;
    if (input.lineItems.some((li) => li.code === 'MINIMUM_ORDER')) return 0;
    const material = input.lineItems.filter((li) => li.code === 'MATERIAL').reduce((s, li) => s + li.totalCents, 0);
    if (material <= 0) return 0;
    const raw = Math.floor((material * pct) / 100);
    const costFloor = Math.ceil((material * input.shopCostCents) / input.subtotalCents);
    return Math.max(0, Math.min(raw, material - costFloor, input.platformFeeCents));
}

export function applyMembershipBenefits<T extends BenefitTotalsInput>(totals: T, membership: MembershipForBenefits): BenefitResult<T> {
    const none: BenefitResult<T> = { totals, benefits: [], flags: { priority: false, guaranteedDates: false, membershipId: null }, shippingWaivedCents: 0, materialDiscountCents: 0 };
    if (!membership || !membership.isMember) return none;
    const b = membership.benefits;

    const discount = materialDiscountCents(totals, b.materialDiscountPct);
    const subtotalCents = totals.subtotalCents - discount;
    const platformFeeCents = totals.platformFeeCents - discount;

    const qualifying = totals.qualifyingSubtotalCents ?? totals.subtotalCents;
    const freeShipping = totals.shippingMethod === 'STANDARD' && !totals.freight && totals.shippingCents > 0 && qualifying >= b.freeShippingThresholdCents;
    const shippingWaived = freeShipping ? totals.shippingCents : 0;
    const shippingCents = totals.shippingCents - shippingWaived;

    const benefits: AppliedBenefit[] = [];
    if (shippingWaived > 0) benefits.push({ code: 'FREE_SHIPPING', label: 'Prime free standard shipping', savingsCents: shippingWaived });
    if (discount > 0) benefits.push({ code: 'MATERIAL_DISCOUNT', label: `Prime member material pricing (${b.materialDiscountPct}% off material)`, savingsCents: discount });
    if (b.priorityQueue) benefits.push({ code: 'PRIORITY_QUEUE', label: 'Priority shop slot', savingsCents: 0 });
    if (b.guaranteedDates) benefits.push({ code: 'GUARANTEED_DATES', label: 'Guaranteed-date eligible', savingsCents: 0 });

    return {
        totals: {
            ...totals,
            subtotalCents,
            platformFeeCents,
            shippingCents,
            totalCents: subtotalCents + shippingCents + totals.taxCents,
        },
        benefits,
        flags: { priority: b.priorityQueue, guaranteedDates: b.guaranteedDates, membershipId: membership.membershipId },
        shippingWaivedCents: shippingWaived,
        materialDiscountCents: discount,
    };
}

/** Savings a non-member would get here (the "Prime members ship this free" card). */
export function primeSavingsPreview(totals: BenefitTotalsInput, benefits: PrimeBenefits): number {
    const r = applyMembershipBenefits(totals, { isMember: true, membershipId: null, benefits });
    return r.shippingWaivedCents + r.materialDiscountCents;
}
