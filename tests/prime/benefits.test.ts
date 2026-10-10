import { describe, expect, it } from 'vitest';
import type { QuoteLineItem } from '@/contracts/quotes';
import { applyMembershipBenefits, materialDiscountCents, type BenefitTotalsInput, type MembershipForBenefits } from '@/server/prime/benefits';
import { isMemberStatus, primePlans, trialTimeline } from '@/server/prime/membership-config';

const benefits = { freeShippingThresholdCents: 7500, materialDiscountPct: 10, priorityQueue: true, guaranteedDates: true, earlyAccess: true };
const member: MembershipForBenefits = { isMember: true, membershipId: 'mem_1', benefits };

function line(code: QuoteLineItem['code'], totalCents: number): QuoteLineItem {
    return { code, label: code, explainer: '', unitCents: totalCents, quantity: 1, totalCents };
}

/** subtotal 10000 = material 3000 + cutting 7000; 35% margin -> shop cost 7407, platform fee 2593. */
function totals(overrides: Partial<BenefitTotalsInput> = {}): BenefitTotalsInput {
    return {
        quantity: 10,
        unitPriceCents: 1000,
        subtotalCents: 10000,
        shippingCents: 1500,
        taxCents: 0,
        totalCents: 11500,
        shopCostCents: 7407,
        platformFeeCents: 2593,
        currency: 'usd',
        lineItems: [line('MATERIAL', 3000), line('CUTTING', 7000)],
        shippingMethod: 'STANDARD',
        ...overrides,
    };
}

describe('applyMembershipBenefits', () => {
    it('gives nothing to non-members (null or not active)', () => {
        const t = totals();
        expect(applyMembershipBenefits(t, null).totals).toEqual(t);
        const lapsed = applyMembershipBenefits(t, { ...member, isMember: false });
        expect(lapsed.totals).toEqual(t);
        expect(lapsed.benefits).toEqual([]);
        expect(lapsed.flags.priority).toBe(false);
        expect(isMemberStatus('past_due')).toBe(false);
        expect(isMemberStatus('canceled')).toBe(false);
        expect(isMemberStatus('incomplete')).toBe(false);
        expect(isMemberStatus('trialing')).toBe(true);
        expect(isMemberStatus('active')).toBe(true);
    });

    it('waives standard shipping at or over the threshold only', () => {
        const over = applyMembershipBenefits(totals(), member);
        expect(over.totals.shippingCents).toBe(0);
        expect(over.shippingWaivedCents).toBe(1500);
        expect(over.benefits.find((b) => b.code === 'FREE_SHIPPING')?.savingsCents).toBe(1500);

        const under = applyMembershipBenefits(totals({ subtotalCents: 7000, shopCostCents: 5185, platformFeeCents: 1815, lineItems: [line('MATERIAL', 2000), line('CUTTING', 5000)] }), member);
        expect(under.totals.shippingCents).toBe(1500);
        // ...but a cart whose total subtotal qualifies ships every part free.
        const cart = applyMembershipBenefits(totals({ subtotalCents: 7000, shopCostCents: 5185, platformFeeCents: 1815, lineItems: [line('MATERIAL', 2000), line('CUTTING', 5000)], qualifyingSubtotalCents: 14000 }), member);
        expect(cart.totals.shippingCents).toBe(0);

        expect(applyMembershipBenefits(totals({ shippingMethod: 'EXPRESS' }), member).totals.shippingCents).toBe(1500);
        expect(applyMembershipBenefits(totals({ freight: true }), member).totals.shippingCents).toBe(1500);
    });

    it('takes the material discount out of the platform fee and never below cost', () => {
        const r = applyMembershipBenefits(totals(), member);
        expect(r.materialDiscountCents).toBe(300); // 10% of 3000
        expect(r.totals.subtotalCents).toBe(9700);
        expect(r.totals.platformFeeCents).toBe(2293);
        expect(r.totals.shopCostCents).toBe(7407); // the shop is paid the same
        expect(r.totals.shopCostCents + r.totals.platformFeeCents).toBe(r.totals.subtotalCents);
        expect(r.totals.totalCents).toBe(r.totals.subtotalCents + r.totals.shippingCents + r.totals.taxCents);

        // A huge % is capped at the material margin: material - ceil(material * shopCost / subtotal).
        const cap = materialDiscountCents(totals(), 50);
        expect(cap).toBe(3000 - Math.ceil((3000 * 7407) / 10000));
        expect(3000 - cap).toBeGreaterThanOrEqual((3000 * 7407) / 10000);
        // Never more than the platform fee.
        expect(materialDiscountCents(totals({ platformFeeCents: 100 }), 50)).toBe(100);
        // No discount under a minimum-order floor, or without material.
        expect(materialDiscountCents(totals({ lineItems: [line('MATERIAL', 3000), line('MINIMUM_ORDER', 500)] }), 10)).toBe(0);
        expect(materialDiscountCents(totals({ lineItems: [line('CUTTING', 10000)] }), 10)).toBe(0);
    });

    it('flags priority + guaranteed-date eligibility', () => {
        const r = applyMembershipBenefits(totals(), member);
        expect(r.flags).toEqual({ priority: true, guaranteedDates: true, membershipId: 'mem_1' });
        expect(r.benefits.map((b) => b.code)).toEqual(['FREE_SHIPPING', 'MATERIAL_DISCOUNT', 'PRIORITY_QUEUE', 'GUARANTEED_DATES']);
    });
});

describe('Prime config', () => {
    it('prices plans in cents with an annual saving', () => {
        const [monthly, annual] = primePlans();
        expect(monthly).toMatchObject({ plan: 'monthly', priceCents: 999, interval: 'month' });
        expect(annual).toMatchObject({ plan: 'annual', priceCents: 9900, interval: 'year', perMonthCents: 825 });
        expect(annual.savingsPct).toBe(17);
    });

    it('builds the trial timeline with real dates (today → reminder 2 days before → trial ends)', () => {
        const steps = trialTimeline(new Date('2026-10-09T15:00:00Z'), 7, 'monthly');
        expect(steps.map((s) => [s.key, s.date])).toEqual([
            ['today', '2026-10-09'],
            ['reminder', '2026-10-14'],
            ['trial_ends', '2026-10-16'],
        ]);
        expect(steps[2].description).toContain('$9.99/month');
    });
});
