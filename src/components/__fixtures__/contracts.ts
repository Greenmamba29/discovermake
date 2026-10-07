/** Contract-shaped fixtures for component tests (types come from @/contracts, so drift fails typecheck). */
import type { CatalogResponse, PartView, QuoteView } from '@/contracts';

export const NOW = '2026-10-06T12:00:00.000Z';

export const part: PartView = {
    id: 'prt_test',
    buildId: 'bld_test',
    buildDisplayId: 'DM-7K3QX',
    filename: 'plate.dxf',
    format: 'dxf',
    sizeBytes: 1200,
    status: 'READY',
    universalStatus: 'READY',
    units: 'mm',
    designVersion: 1,
    features: {
        sourceUnits: 'mm',
        unitsFromFile: true,
        bboxWidthMm: 120,
        bboxHeightMm: 80,
        outerContourCount: 1,
        innerContourCount: 1,
        openContourCount: 0,
        cutLengthMm: 500,
        pierceCount: 2,
        netAreaMm2: 9000,
        grossAreaMm2: 9600,
        smallestFeatureMm: 6,
        smallestHoleMm: 6.5,
        minHoleToEdgeMm: 8,
        holes: [],
        bendLines: [],
        bendCount: 0,
        textEntityCount: 0,
        entityCounts: { LWPOLYLINE: 1, CIRCLE: 1 },
    },
    dfm: { rulesetVersion: 'dfm-test', makeabilityScore: 100, blocking: false, violations: [], materialId: null, thicknessOptionId: null, checkedAt: NOW },
    preview: { outer: [[[0, 0], [120, 0], [120, 80], [0, 80]]], holes: [], bendLines: [], widthMm: 120, heightMm: 80, svgPath: 'M0 80 L120 80 L120 0 L0 0 Z' },
    error: null,
    rulesetVersion: 'dfm-test',
    createdAt: NOW,
    analyzedAt: NOW,
};

const thickness = (id: string, mm: number, label: string) => ({
    id,
    thicknessMm: mm,
    label,
    processId: 'prc_fiber_laser',
    bendable: true,
    maxPartWidthMm: 1200,
    maxPartHeightMm: 600,
    minHoleDiameterMm: 1,
    minFeatureMm: 1,
    minHoleToEdgeMm: 1,
});

export const catalog: CatalogResponse = {
    materials: [
        {
            id: 'mat_al_6061',
            slug: 'al-6061',
            name: 'Aluminum 6061',
            category: 'METAL',
            description: 'Structural aluminum',
            swatchHex: '#c8ccd0',
            compatibleServiceIds: [],
            thicknessOptions: [thickness('thk_al6061_090', 2.29, '0.090"')],
        },
        {
            id: 'mat_steel_crs',
            slug: 'steel-crs',
            name: 'Mild steel',
            category: 'METAL',
            description: 'Cold rolled',
            swatchHex: '#6b6f73',
            compatibleServiceIds: [],
            thicknessOptions: [thickness('thk_crs_16ga', 1.52, '16 ga'), thickness('thk_crs_14ga', 1.9, '14 ga')],
        },
    ],
    processes: [{ id: 'prc_fiber_laser', slug: 'fiber-laser', name: 'Fiber laser', kind: 'FIBER_LASER' }],
    services: [],
    ladderQuantities: [1, 10, 50, 100, 250],
    rulesetVersion: 'dfm-test',
};

export function quoteFor(body: { materialId: string; thicknessOptionId: string; quantity: number }): QuoteView {
    const unit = 2350;
    return {
        id: `qte_${body.materialId}_${body.quantity}`,
        partId: 'prt_test',
        buildId: 'bld_test',
        designVersion: 1,
        config: { partId: 'prt_test', materialId: body.materialId, thicknessOptionId: body.thicknessOptionId, finishServiceId: null, services: [], quantity: body.quantity },
        summary: { materialName: 'Aluminum 6061', thicknessLabel: '0.090"', processName: 'Fiber laser', finishName: null, serviceNames: [], quantity: body.quantity, partFilename: 'plate.dxf', bboxWidthMm: 120, bboxHeightMm: 80, unitMassG: 60 },
        route: { shopId: 'shop_x', shopName: 'Test Works', city: 'Philadelphia', region: 'PA', rating: null, processName: 'Fiber laser', machineLabel: null, certifications: [] },
        tier: 'PROTOTYPE',
        lineItems: [{ code: 'MATERIAL', label: 'Material', explainer: 'Sheet stock', unitCents: unit, quantity: body.quantity, totalCents: unit * body.quantity }],
        ladder: [{ quantity: 1, tier: 'PROTOTYPE', unitPriceCents: unit, totalCents: unit, shipDate: '2026-10-12', savingsPct: 0 }],
        shippingOptions: [{ method: 'STANDARD', label: 'Standard', priceCents: 1200, deliveryDate: '2026-10-19', transitDays: 5 }],
        unitPriceCents: unit,
        subtotalCents: unit * body.quantity,
        currency: 'usd',
        trustLevel: 'BINDING',
        status: 'READY',
        orderable: true,
        shipDate: '2026-10-12',
        leadTimeDays: 4,
        validUntil: '2026-10-20T12:00:00.000Z',
        rulesetVersion: 'dfm-test',
        pricingVersion: 'p1',
        dfm: { rulesetVersion: 'dfm-test', makeabilityScore: 96, blocking: false, violations: [], materialId: body.materialId, thicknessOptionId: body.thicknessOptionId, checkedAt: NOW },
        createdAt: NOW,
    };
}

