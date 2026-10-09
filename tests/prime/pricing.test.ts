/**
 * Supplier-route pricing: binding composition from a supplier-confirmed offer, risk reserve
 * tiers, rounding up, never below cost, deposit split and the credit on the first charge.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIME_POLICY } from '@/server/prime/config';
import { assessRisk, depositSplit, firstChargeCents, MIN_CHARGE_CENTS, priceSupplierQuote, type OfferForPricing } from '@/server/prime/pricing';

const offer = (o: Partial<OfferForPricing> = {}): OfferForPricing => ({
    unitPriceCents: 640,
    quantity: 250,
    toolingCents: 0,
    shippingCents: 18_000,
    incoterm: 'DDP',
    productionLeadDays: 12,
    shippingLeadDays: 9,
    confidence: 0.9,
    ...o,
});
const receiving = { feeCents: 4500, perUnitCents: 15 };
const policy = DEFAULT_PRIME_POLICY;

describe('supplier binding quote composition', () => {
    it('landed cost + receiving + margin + risk reserve, line items add up, split is consistent', () => {
        const p = priceSupplierQuote({ offer: offer(), supplier: { verified: true, country: 'VN' }, firstOrder: false, receiving, policy });
        expect(p.goodsCents).toBe(640 * 250);
        expect(p.freightCents).toBe(18_000);
        expect(p.dutiesCents).toBe(0); // DDP
        expect(p.landedCents).toBe(160_000 + 18_000);
        expect(p.receivingFeeCents).toBe(4500 + 15 * 250);
        expect(p.marginCents).toBe(Math.ceil(178_000 * 0.18));
        expect(p.risk.tier).toBe('LOW');
        expect(p.riskReserveCents).toBe(Math.ceil(178_000 * 0.03));
        expect(p.subtotalCents).toBe(p.unitPriceCents * 250);
        expect(p.lineItems.reduce((s, li) => s + li.totalCents, 0)).toBe(p.subtotalCents);
        expect(p.shopCostCents + p.platformFeeCents).toBe(p.subtotalCents);
        expect(p.shopCostCents).toBe(p.receivingFeeCents);
        expect(p.assumptions.join(' ')).toMatch(/DDP/);
        // Buyer-facing labels never name the supplier.
        expect(JSON.stringify(p.lineItems)).not.toMatch(/alibaba|supplier ltd/i);
    });

    it('rounds the unit price UP and books the rounding in the platform fee; never below cost', () => {
        for (const qty of [1, 7, 33, 250, 997]) {
            const p = priceSupplierQuote({ offer: offer({ quantity: qty, unitPriceCents: 333, shippingCents: 1001 }), supplier: { verified: true, country: 'VN' }, firstOrder: false, receiving, policy });
            const raw = p.landedCents + p.receivingFeeCents + p.marginCents + p.riskReserveCents;
            expect(p.unitPriceCents).toBe(Math.ceil(raw / qty));
            expect(p.roundingCents).toBeGreaterThanOrEqual(0);
            expect(p.roundingCents).toBeLessThan(qty);
            expect(p.subtotalCents).toBeGreaterThanOrEqual(p.landedCents + p.receivingFeeCents);
        }
        const zeroMargin = priceSupplierQuote({
            offer: offer(),
            supplier: { verified: true, country: 'VN' },
            firstOrder: false,
            receiving,
            policy: { marginPct: 0, riskReservePct: { LOW: 0, MEDIUM: 0, HIGH: 0, VERY_HIGH: 0 } },
        });
        expect(zeroMargin.subtotalCents).toBeGreaterThanOrEqual(zeroMargin.landedCents + zeroMargin.receivingFeeCents);
    });

    it('risk reserve tiers by verification, lead time, incoterm, first order and confidence', () => {
        const low = assessRisk(offer(), { verified: true, country: 'VN' }, false, policy);
        expect(low).toMatchObject({ tier: 'LOW', reservePct: 0.03 });
        const medium = assessRisk(offer({ incoterm: 'FOB' }), { verified: true, country: 'CN' }, true, policy);
        expect(medium.score).toBeCloseTo(0.35);
        expect(medium).toMatchObject({ tier: 'MEDIUM', reservePct: 0.06 });
        const high = assessRisk(offer({ productionLeadDays: 30, shippingLeadDays: 20 }), { verified: false, country: 'CN' }, false, policy);
        expect(high.score).toBeCloseTo(0.6);
        expect(high).toMatchObject({ tier: 'HIGH', reservePct: 0.1 });
        const veryHigh = assessRisk(offer({ incoterm: 'EXW', productionLeadDays: 40, shippingLeadDays: 10, confidence: 0.5 }), { verified: false, country: 'CN' }, true, policy);
        expect(veryHigh).toMatchObject({ tier: 'VERY_HIGH', reservePct: 0.15 });
        expect(veryHigh.factors.length).toBeGreaterThanOrEqual(4);
        // Higher risk, higher reserve, same offer otherwise.
        const a = priceSupplierQuote({ offer: offer(), supplier: { verified: true, country: 'VN' }, firstOrder: false, receiving, policy });
        const b = priceSupplierQuote({ offer: offer(), supplier: { verified: false, country: 'VN' }, firstOrder: true, receiving, policy });
        expect(b.riskReserveCents).toBeGreaterThan(a.riskReserveCents);
    });

    it('non-DDP offers carry estimated duties and freight as stated assumptions', () => {
        const p = priceSupplierQuote({ offer: offer({ incoterm: 'FOB', shippingCents: null }), supplier: { verified: true, country: 'CN' }, firstOrder: false, receiving, policy });
        expect(p.dutiesCents).toBe(Math.ceil(160_000 * 0.3));
        expect(p.freightCents).toBe(Math.max(15_000, Math.ceil(160_000 * 0.12)));
        expect(p.assumptions.some((a) => /duties estimated at 30%/i.test(a))).toBe(true);
        expect(p.assumptions.some((a) => /Freight not quoted/i.test(a))).toBe(true);
        expect(p.excludedCosts).toContain('Sales tax (not collected)');
    });

    it('rejects malformed offers', () => {
        expect(() => priceSupplierQuote({ offer: offer({ quantity: 0 }), supplier: { verified: true, country: 'VN' }, firstOrder: false, receiving, policy })).toThrow(/quantity/);
        expect(() => priceSupplierQuote({ offer: offer({ unitPriceCents: 1.5 }), supplier: { verified: true, country: 'VN' }, firstOrder: false, receiving, policy })).toThrow(/cents/);
    });
});

describe('deposit split and credits', () => {
    it('deposit rounds up; deposit + balance = total', () => {
        expect(depositSplit(10_001, 0.5)).toEqual({ depositCents: 5001, balanceCents: 5000 });
        expect(depositSplit(10_000, 0.3)).toEqual({ depositCents: 3000, balanceCents: 7000 });
        expect(depositSplit(999, 1)).toEqual({ depositCents: 999, balanceCents: 0 });
        expect(depositSplit(999, 0)).toEqual({ depositCents: 0, balanceCents: 999 });
        expect(() => depositSplit(100, 1.2)).toThrow();
    });

    it('a credit reduces the first charge but always leaves the processor minimum', () => {
        expect(firstChargeCents(10_000, 2_500)).toEqual({ chargeCents: 7_500, creditCents: 2_500 });
        expect(firstChargeCents(1_000, 5_000)).toEqual({ chargeCents: MIN_CHARGE_CENTS, creditCents: 1_000 - MIN_CHARGE_CENTS });
        expect(firstChargeCents(40, 100)).toEqual({ chargeCents: 40, creditCents: 0 });
        expect(firstChargeCents(10_000, 0)).toEqual({ chargeCents: 10_000, creditCents: 0 });
    });
});
