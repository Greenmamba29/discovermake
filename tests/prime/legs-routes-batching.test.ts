/**
 * Pure parts of R3: the supplier leg state machine (incl. the QA-fail and direct-ship paths), the
 * buyer's one-sentence-per-step tracker, route scoring determinism and the batching heuristic.
 */
import { describe, expect, it } from 'vitest';
import { assertLegTransition, canLegTransition, IllegalLegTransitionError, LEG_TRANSITIONS, opsAllowedNext, orderStepsForLeg } from '@/server/prime/legs';
import { buildSupplierSteps } from '@/server/prime/views';
import { canTransition } from '@/server/orders/state';
import { estimateCo2Kg, scoreRoutes, type RouteCandidateInput } from '@/server/routing/compare';
import { batchIdFor, planBatches, type BatchJob } from '@/server/dispatch/batching';
import { SUPPLIER_LEG_STATUSES } from '@/contracts/enums';

describe('supplier leg state machine', () => {
    it('happy path through a receiving partner', () => {
        const path = ['PO_PLACED', 'IN_PRODUCTION_AT_SUPPLIER', 'SHIPPED_INBOUND', 'RECEIVED_AT_PARTNER', 'DELIVERED'] as const;
        for (let i = 0; i < path.length - 1; i++) expect(canLegTransition(path[i], path[i + 1], { directShip: false })).toBe(true);
    });

    it('QA at receipt can fail, rework passes back, or the order is refunded (cancelled)', () => {
        expect(canLegTransition('RECEIVED_AT_PARTNER', 'QA_FAILED', { directShip: false })).toBe(true);
        expect(canLegTransition('QA_FAILED', 'RECEIVED_AT_PARTNER', { directShip: false })).toBe(true);
        expect(canLegTransition('QA_FAILED', 'CANCELLED', { directShip: false })).toBe(true);
        expect(canLegTransition('QA_FAILED', 'DELIVERED', { directShip: false })).toBe(false);
        expect(() => assertLegTransition('QA_FAILED', 'DELIVERED', { directShip: false })).toThrow(IllegalLegTransitionError);
    });

    it('direct ship skips the partner both ways; partner legs cannot jump to delivered', () => {
        expect(canLegTransition('SHIPPED_INBOUND', 'DELIVERED', { directShip: true })).toBe(true);
        expect(canLegTransition('SHIPPED_INBOUND', 'DELIVERED', { directShip: false })).toBe(false);
        expect(canLegTransition('SHIPPED_INBOUND', 'RECEIVED_AT_PARTNER', { directShip: true })).toBe(false);
        expect(canLegTransition('RECEIVED_AT_PARTNER', 'DELIVERED', { directShip: true })).toBe(false);
    });

    it('terminal statuses stay terminal; no skipping production', () => {
        expect(LEG_TRANSITIONS.DELIVERED).toEqual([]);
        expect(LEG_TRANSITIONS.CANCELLED).toEqual([]);
        expect(canLegTransition('PO_PLACED', 'SHIPPED_INBOUND', { directShip: false })).toBe(false);
        for (const s of SUPPLIER_LEG_STATUSES) expect(canLegTransition(s, 'PO_PLACED', { directShip: false })).toBe(false);
    });

    it('ops may only set supplier-side statuses', () => {
        expect(opsAllowedNext('PO_PLACED', { directShip: false })).toEqual(['IN_PRODUCTION_AT_SUPPLIER']);
        expect(opsAllowedNext('SHIPPED_INBOUND', { directShip: false })).toEqual([]);
        expect(opsAllowedNext('SHIPPED_INBOUND', { directShip: true })).toEqual(['DELIVERED']);
        expect(opsAllowedNext('RECEIVED_AT_PARTNER', { directShip: false })).toEqual([]);
    });

    it('order moves that accompany the leg are legal in the unchanged R1 order table', () => {
        // PAID -> DISPATCHED (PO) -> ACCEPTED (production) -> IN_PRODUCTION (received) -> QA_PASSED -> SHIPPED -> DELIVERED
        expect(canTransition('PAID', 'DISPATCHED')).toBe(true);
        expect(orderStepsForLeg('IN_PRODUCTION_AT_SUPPLIER', { directShip: false })).toEqual(['ACCEPTED']);
        expect(canTransition('DISPATCHED', 'ACCEPTED')).toBe(true);
        expect(orderStepsForLeg('SHIPPED_INBOUND', { directShip: true })).toEqual(['IN_PRODUCTION', 'QA_PASSED']);
        expect(canTransition('ACCEPTED', 'IN_PRODUCTION') && canTransition('IN_PRODUCTION', 'QA_PASSED')).toBe(true);
        expect(orderStepsForLeg('DELIVERED', { directShip: true })).toEqual(['SHIPPED', 'DELIVERED']);
        // Shipping without a QA pass stays impossible.
        expect(canTransition('IN_PRODUCTION', 'SHIPPED')).toBe(false);
    });
});

describe('buyer supplier-route tracker', () => {
    const t = (iso: string) => new Date(iso);
    const base = { createdAt: t('2026-10-01T10:00:00Z'), productionStartedAt: null, shippedInboundAt: null, receivedAt: null, deliveredAt: null, directShip: false };

    it('awaiting PO approval: one current sentence, nothing done', () => {
        const steps = buildSupplierSteps({ leg: null, order: { status: 'PAID', shippedAt: null, deliveredAt: null }, origin: 'Vietnam', partnerCity: 'Philadelphia' });
        expect(steps.map((s) => s.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
        expect(steps[0].sentence).toMatch(/approving the purchase order/);
    });

    it('in production at the supplier, then inspecting at the partner', () => {
        const inProd = buildSupplierSteps({ leg: { ...base, status: 'IN_PRODUCTION_AT_SUPPLIER', productionStartedAt: t('2026-10-02T10:00:00Z') }, order: { status: 'ACCEPTED', shippedAt: null, deliveredAt: null }, origin: 'Vietnam', partnerCity: 'Philadelphia' });
        expect(inProd.map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']);
        expect(inProd[0].sentence).toBe('Purchase order placed with a verified partner in Vietnam');
        const received = buildSupplierSteps({
            leg: { ...base, status: 'RECEIVED_AT_PARTNER', productionStartedAt: t('2026-10-02T10:00:00Z'), shippedInboundAt: t('2026-10-10T10:00:00Z'), receivedAt: t('2026-10-20T10:00:00Z') },
            order: { status: 'IN_PRODUCTION', shippedAt: null, deliveredAt: null },
            origin: 'Vietnam',
            partnerCity: 'Philadelphia',
        });
        expect(received[3]).toMatchObject({ key: 'RECEIVED_AT_PARTNER', state: 'current', sentence: 'Received by our partner in Philadelphia · inspecting' });
        const failed = buildSupplierSteps({
            leg: { ...base, status: 'QA_FAILED', productionStartedAt: t('2026-10-02T10:00:00Z'), shippedInboundAt: t('2026-10-10T10:00:00Z'), receivedAt: t('2026-10-20T10:00:00Z') },
            order: { status: 'QA_FAILED', shippedAt: null, deliveredAt: null },
            origin: 'Vietnam',
            partnerCity: 'Philadelphia',
        });
        expect(failed[3].state).toBe('failed');
    });

    it('delivered: every step done; direct ship has four steps', () => {
        const done = buildSupplierSteps({
            leg: { ...base, status: 'DELIVERED', productionStartedAt: t('2026-10-02T10:00:00Z'), shippedInboundAt: t('2026-10-10T10:00:00Z'), receivedAt: t('2026-10-20T10:00:00Z'), deliveredAt: t('2026-10-24T10:00:00Z') },
            order: { status: 'COMPLETE', shippedAt: t('2026-10-21T10:00:00Z'), deliveredAt: t('2026-10-24T10:00:00Z') },
            origin: 'Vietnam',
            partnerCity: 'Philadelphia',
        });
        expect(done.every((s) => s.state === 'done')).toBe(true);
        const direct = buildSupplierSteps({ leg: { ...base, directShip: true, status: 'PO_PLACED' }, order: { status: 'DISPATCHED', shippedAt: null, deliveredAt: null }, origin: 'China', partnerCity: null });
        expect(direct.map((s) => s.key)).toEqual(['PO_PLACED', 'IN_PRODUCTION_AT_SUPPLIER', 'SHIPPED_INBOUND', 'DELIVERED']);
    });
});

describe('route scoring', () => {
    const cand = (o: Partial<RouteCandidateInput> & { id: string }): RouteCandidateInput => ({
        kind: 'shop',
        label: o.id,
        location: 'Philadelphia, PA',
        trustLevel: 'BINDING',
        totalCents: 100_000,
        unitCents: 400,
        quantity: 250,
        arrivesBy: '2026-10-20',
        quality: 0.8,
        rating: null,
        verified: true,
        co2Kg: 50,
        filledFromStock: false,
        capabilities: [],
        certifications: [],
        orderable: true,
        ...o,
    });

    it('scores on cost, date, quality and CO2 and recommends exactly one, deterministically', () => {
        const input = [
            cand({ id: 'shop:a', totalCents: 120_000, arrivesBy: '2026-10-16' }),
            cand({ id: 'offer:b', kind: 'supplier', trustLevel: 'SUPPLIER_CONFIRMED', totalCents: 80_000, arrivesBy: '2026-11-05', co2Kg: 90, quality: 0.9 }),
            cand({ id: 'shop:c', trustLevel: 'SUPPLIER_ESTIMATE', totalCents: 60_000, arrivesBy: '2026-10-15', orderable: false }),
        ];
        const a = scoreRoutes(input);
        const b = scoreRoutes([...input].reverse());
        expect(a).toEqual(b);
        expect(a.filter((c) => c.recommended)).toHaveLength(1);
        // The estimate is cheapest and fastest but cannot be Recommended.
        expect(a.find((c) => c.id === 'shop:c')!.recommended).toBe(false);
        expect(a[0].recommended).toBe(true);
    });

    it('ties break on total, then date, then id', () => {
        const r = scoreRoutes([cand({ id: 'shop:z' }), cand({ id: 'shop:y' })]);
        expect(r[0].id).toBe('shop:y');
        expect(r.every((c) => c.score === 0)).toBe(true);
    });

    it('CO2 estimate grows with mass and ocean freight', () => {
        const local = estimateCo2Kg({ massKg: 10, materialName: 'Aluminum 6061-T6', originCountry: 'US' });
        const asia = estimateCo2Kg({ massKg: 10, materialName: 'Aluminum 6061-T6', originCountry: 'VN' });
        expect(local).toBeGreaterThan(80);
        expect(asia).toBeGreaterThan(local);
        expect(estimateCo2Kg({ massKg: 10, materialName: 'Birch plywood', originCountry: 'US' })).toBeLessThan(local);
    });
});

describe('dispatch batching (first-fit decreasing)', () => {
    const SHEET = 1219 * 2438;
    const job = (id: string, o: Partial<BatchJob> = {}): BatchJob => ({
        id,
        shopId: 'shop_a',
        materialId: 'mat_al_5052',
        thicknessOptionId: 'thk_al5052_063',
        processId: 'prc_fiber_laser',
        areaMm2: 500_000,
        windowStart: '2026-10-05',
        windowEnd: '2026-10-12',
        ...o,
    });
    const opts = { sheetAreaMm2: () => SHEET };

    it('groups compatible jobs by sheet area, largest first, within one sheet', () => {
        const batches = planBatches([job('j1', { areaMm2: 1_500_000 }), job('j2', { areaMm2: 900_000 }), job('j3', { areaMm2: 600_000 }), job('j4', { areaMm2: 300_000 })], opts);
        // capacity = 0.85 x 2,971,922 ≈ 2,526,134: j1 + j2 (2.4M) fit, j3 + j4 open a second bin.
        expect(batches.map((b) => b.jobIds)).toEqual([
            ['j1', 'j2'],
            ['j3', 'j4'],
        ]);
        expect(batches[0].id).toBe(batchIdFor(['j2', 'j1']));
    });

    it('never mixes material, thickness, process or shop; needs overlapping ship windows', () => {
        const batches = planBatches(
            [
                job('a1'),
                job('a2', { thicknessOptionId: 'thk_al5052_080' }),
                job('a3', { shopId: 'shop_b' }),
                job('a4', { processId: 'prc_co2_laser' }),
                job('a5', { windowStart: '2026-10-20', windowEnd: '2026-10-25' }),
            ],
            opts,
        );
        expect(batches).toEqual([]);
        const overlap = planBatches([job('b1'), job('b2', { windowStart: '2026-10-10', windowEnd: '2026-10-20' })], opts);
        expect(overlap).toHaveLength(1);
        expect(overlap[0]).toMatchObject({ windowStart: '2026-10-10', windowEnd: '2026-10-12' });
    });

    it('is deterministic and leaves oversize jobs alone', () => {
        const jobs = [job('c1', { areaMm2: 400_000 }), job('c2', { areaMm2: 400_000 }), job('c3', { areaMm2: SHEET * 2 })];
        expect(planBatches(jobs, opts)).toEqual(planBatches([...jobs].reverse(), opts));
        expect(planBatches(jobs, opts).flatMap((b) => b.jobIds)).not.toContain('c3');
    });
});
