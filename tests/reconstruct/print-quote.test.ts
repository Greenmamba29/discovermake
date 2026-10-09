/**
 * 3D-print quote engine: pricing math (ladder, never below cost, minimum order), build-volume
 * fit, print DFM, and the BINDING conditions against the seeded partner (capability, fit, DFM).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { builds, parts, shopPrintCapabilities, shopPrintRateCards } from '@/server/db/schema';
import { newBuildDisplayId, newId } from '@/server/ids';
import { getQuote } from '@/server/quote';
import {
    createPrintQuote,
    effectiveMarginPct,
    effectiveVolumeMm3,
    fitsBuildVolume,
    PRINT_LADDER_QUANTITIES,
    pricePrint,
    printRateCardIsActive,
    runPrintDfm,
    type PrintGeometry,
} from '@/server/quote/printing';
import { devPrintRateCard, PRINT_MATERIAL_SEEDS } from '@/server/quote/printing/catalog';
import { toPrintMaterial, toPrintRateCard } from '@/server/quote/printing/quotes';
import { useTestDb as withTestDb } from '../support/db';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'cad', 'reconstruct-knob', 'manifest.json'), 'utf8')) as { metrics: { bbox_mm: number[]; volume_mm3: number; surface_area_mm2: number; min_wall_mm: number; bridge_span_mm: number } };
const KNOB: PrintGeometry = {
    bboxMm: manifest.metrics.bbox_mm as [number, number, number],
    volumeMm3: manifest.metrics.volume_mm3,
    surfaceAreaMm2: manifest.metrics.surface_area_mm2,
    minWallMm: manifest.metrics.min_wall_mm,
    bridgeSpanMm: manifest.metrics.bridge_span_mm,
};
const rc = toPrintRateCard({ ...devPrintRateCard('shop_x'), createdAt: new Date(), updatedAt: new Date() } as never);
const material = (slug: string) => toPrintMaterial({ ...PRINT_MATERIAL_SEEDS.find((m) => m.slug === slug)!, calibrated: false, active: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() } as never);

describe('print pricing (pure)', () => {
    it('prices the golden knob from its manifest', () => {
        expect(KNOB.bboxMm).toEqual([38.1, 38.1, 22]);
        const p = pricePrint({ geometry: KNOB, material: material('asa'), rateCard: rc, quantity: 1 });
        const shell = Math.min(KNOB.volumeMm3, KNOB.surfaceAreaMm2 * 1.2);
        expect(p.effectiveVolumeMm3).toBeCloseTo(shell + 0.4 * (KNOB.volumeMm3 - shell));
        expect(p.unitMassG).toBeCloseTo((p.effectiveVolumeMm3 * 1070) / 1e6);
        expect(p.layers).toBe(110); // 22 mm at 0.2 mm
        expect(p.printHoursPerPart).toBeCloseTo(p.effectiveVolumeMm3 / 10_800 + (110 * 4) / 3600);
        expect(p.lineItems.map((l) => l.code)).toEqual(['MATERIAL', 'PRINTING', 'POST_PROCESSING', 'QA', 'HANDLING', 'SETUP']);
        expect(p.lineItems.reduce((s, l) => s + l.totalCents, 0)).toBe(p.subtotalCents);
        expect(p.subtotalCents).toBe(p.unitPriceCents * 1);
        expect(p.shopCostCents + p.platformFeeCents).toBe(p.subtotalCents);
        expect(p.subtotalCents).toBeGreaterThan(1500);
        expect(p.subtotalCents).toBeLessThan(6000);
    });

    it('ladder 1/10/25/50/100: unit price falls, margin never below the floor, never below cost', () => {
        expect([...PRINT_LADDER_QUANTITIES]).toEqual([1, 10, 25, 50, 100]);
        let last = Infinity;
        for (const q of PRINT_LADDER_QUANTITIES) {
            const p = pricePrint({ geometry: KNOB, material: material('petg'), rateCard: rc, quantity: q });
            expect(p.unitPriceCents).toBeLessThanOrEqual(last);
            last = p.unitPriceCents;
            expect(p.effectiveMarginPct).toBeGreaterThanOrEqual(rc.minMarginPct);
            expect(p.subtotalCents).toBeGreaterThanOrEqual(Math.ceil(p.rawCostCents));
            expect(p.shopCostCents).toBeGreaterThanOrEqual(Math.ceil(p.rawCostCents) - 1);
            expect(p.platformFeeCents).toBeGreaterThanOrEqual(0);
        }
        // Even a 100% volume discount cannot cut into cost: the margin floors at minMarginPct.
        expect(effectiveMarginPct({ ...rc, volumeDiscountMax: 1 }, 1000)).toBe(rc.minMarginPct);
        const steep = pricePrint({ geometry: KNOB, material: material('petg'), rateCard: { ...rc, volumeDiscountMax: 1, minMarginPct: 0 }, quantity: 100 });
        expect(steep.subtotalCents).toBeGreaterThanOrEqual(Math.ceil(steep.rawCostCents));
    });

    it('applies the minimum order to a tiny part', () => {
        const tiny: PrintGeometry = { bboxMm: [10, 10, 5], volumeMm3: 300, surfaceAreaMm2: 300, minWallMm: 2, bridgeSpanMm: 0 };
        const p = pricePrint({ geometry: tiny, material: material('pla'), rateCard: rc, quantity: 1 });
        expect(p.minimumApplied).toBe(true);
        expect(p.subtotalCents).toBe(rc.minimumOrderCents);
        expect(p.lineItems.at(-1)?.code).toBe('MINIMUM_ORDER');
        expect(p.lineItems.reduce((s, l) => s + l.totalCents, 0)).toBe(p.subtotalCents);
    });

    it('SLS parts are solid and use the SLS rate', () => {
        const pa = material('nylon-pa12');
        expect(effectiveVolumeMm3(KNOB, 'SLS', rc)).toBe(KNOB.volumeMm3);
        const p = pricePrint({ geometry: KNOB, material: pa, rateCard: rc, quantity: 1 });
        expect(p.layerHeightMm).toBe(0.1);
        expect(p.lineItems.find((l) => l.code === 'POST_PROCESSING')?.label).toMatch(/Depowder/);
    });

    it('fits a build volume in any axis-aligned orientation', () => {
        const fdm = { buildXMm: 250, buildYMm: 210, buildZMm: 220 };
        expect(fitsBuildVolume([38.1, 38.1, 22], fdm)).toBe(true);
        expect(fitsBuildVolume([240, 20, 215], fdm)).toBe(true); // rotated
        expect(fitsBuildVolume([260, 20, 20], fdm)).toBe(false);
        expect(fitsBuildVolume([230, 230, 20], fdm)).toBe(false);
    });

    it('DFM: blocks walls under 1.2 mm, notes bridges and tall parts', () => {
        const at = new Date('2026-10-09T12:00:00Z');
        const ok = runPrintDfm({ geometry: KNOB, material: material('asa'), fits: true, checkedAt: at, materialId: 'mat_print_asa', profileId: 'thk_print_fdm_020' });
        expect(ok).toMatchObject({ blocking: false, violations: [], makeabilityScore: 100 });
        const thin = runPrintDfm({ geometry: { ...KNOB, minWallMm: 1.1 }, material: material('asa'), fits: true, checkedAt: at, materialId: null, profileId: null });
        expect(thin.blocking).toBe(true);
        expect(thin.violations[0]).toMatchObject({ ruleId: 'min_wall_print', severity: 'BLOCKING', thresholdMm: 1.2 });
        expect(runPrintDfm({ geometry: { ...KNOB, minWallMm: 1.2 }, material: material('asa'), fits: true, checkedAt: at, materialId: null, profileId: null }).blocking).toBe(false);
        const bridge = runPrintDfm({ geometry: { ...KNOB, bridgeSpanMm: 12 }, material: material('asa'), fits: false, checkedAt: at, materialId: null, profileId: null });
        expect(bridge.violations.map((v) => v.ruleId)).toEqual(['bridge_span', 'build_volume']);
        expect(bridge.blocking).toBe(false);
    });
});

describe('print quotes: BINDING conditions (seeded partner)', () => {
    const ctx = withTestDb({ seed: true });
    let partId = '';

    beforeAll(async () => {
        const buildId = newId('build');
        await ctx.db.insert(builds).values({ id: buildId, displayId: newBuildDisplayId(), name: 'Knob', origin: 'reconstruct' });
        partId = newId('part');
        await ctx.db.insert(parts).values({ id: partId, buildId, designVersion: 2, fileKey: `parts/${partId}/source.stl`, filename: 'knob-v2.stl', format: 'stl', sizeBytes: 1000, fileSha256: 'a'.repeat(64), units: 'mm', status: 'READY', rulesetVersion: 'print-dfm-2026.10-r6' });
    });
    const quote = (geometry: PrintGeometry, slug = 'petg') => createPrintQuote({ partId, printMaterialSlug: slug, quantity: 1, geometry, family: 'round_knob', stlSha256: 'a'.repeat(64), criticalDims: [{ param: 'diameter_mm', label: 'Outer diameter', nominalMm: 38.1 }] });

    it('is BINDING and orderable when a printer fits and DFM passes', async () => {
        const q = await quote(KNOB);
        expect(q).toMatchObject({ status: 'READY', trustLevel: 'BINDING', orderable: true, rulesetVersion: 'print-dfm-2026.10-r6' });
        expect(q.config).toMatchObject({ process: 'print', materialId: 'mat_print_petg', thicknessOptionId: 'thk_print_fdm_020' });
        expect(q.summary).toMatchObject({ materialName: 'PETG', processName: 'FDM 3D printing', partFilename: 'knob-v2.stl' });
        expect(q.route.machineLabel).toMatch(/FDM farm/);
        expect(q.shippingOptions.length).toBeGreaterThan(0);
        expect(await printRateCardIsActive(q.id)).toBe(true);
        const read = await getQuote(q.id);
        expect(read).toMatchObject({ trustLevel: 'BINDING', orderable: true, route: { machineLabel: expect.stringMatching(/FDM farm/) } });
    });

    it('goes to REVIEW when no partner printer fits the part', async () => {
        const q = await quote({ ...KNOB, bboxMm: [300, 300, 50] });
        expect(q).toMatchObject({ status: 'REVIEW', trustLevel: 'SUPPLIER_ESTIMATE', orderable: false });
        expect(q.dfm.violations.map((v) => v.ruleId)).toContain('build_volume');
    });

    it('needs input (not orderable) when a wall is under 1.2 mm', async () => {
        const q = await quote({ ...KNOB, minWallMm: 0.9 });
        expect(q).toMatchObject({ status: 'NEEDS_INPUT', trustLevel: 'SUPPLIER_ESTIMATE', orderable: false });
        expect(q.dfm.blocking).toBe(true);
    });

    it('is not BINDING without an active 3D_PRINT capability, nor once the print rate card changes', async () => {
        await ctx.db.update(shopPrintCapabilities).set({ active: false }).where(eq(shopPrintCapabilities.printMaterialId, 'mat_print_asa'));
        try {
            const q = await quote(KNOB, 'asa');
            expect(q).toMatchObject({ status: 'REVIEW', trustLevel: 'SUPPLIER_ESTIMATE', orderable: false });
        } finally {
            await ctx.db.update(shopPrintCapabilities).set({ active: true }).where(eq(shopPrintCapabilities.printMaterialId, 'mat_print_asa'));
        }
        const q = await quote(KNOB, 'asa');
        expect(q.trustLevel).toBe('BINDING');
        await ctx.db.update(shopPrintRateCards).set({ active: false });
        try {
            expect(await printRateCardIsActive(q.id)).toBe(false);
            await expect(quote(KNOB, 'asa')).rejects.toMatchObject({ code: 'CONFLICT' });
        } finally {
            await ctx.db.update(shopPrintRateCards).set({ active: true });
        }
    });

    it('rejects a sheet part and keeps POST /api/quotes for sheet quotes only', async () => {
        const { createQuote } = await import('@/server/quote');
        await expect(createQuote({ partId, materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', finishServiceId: null, services: [], quantity: 1, process: 'print' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
});
