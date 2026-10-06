/**
 * R1 catalog + dev partner shop seed. Idempotent: every row has a stable id and
 * is upserted, so running it again updates coefficients in place.
 *
 *   bun run db:seed                 # CLI: src/server/db/cli/seed.ts; seeds DATABASE_URL, prints a dev Shop Console token on first run
 *   SEED_SHOP_TOKEN=dmshop_... bun run db:seed   # deterministic token (e2e)
 *
 * ALL COEFFICIENTS ARE DEFAULTS TO BE CALIBRATED (calibrated=false) against real
 * shop invoices with the golden-part suite (workflow 02, NFR-2 ±8%). They are
 * reasonable industry ballparks for a 4 kW fiber laser, 150 W CO2 laser and a
 * CNC press brake in the US Northeast, Oct 2026.
 *
 * Relative imports only (runs under bun + vitest outside Next).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Address } from '../../contracts/common';
import { generateToken, sha256Hex } from '../auth/tokens';
import { getDb, type Db } from './index';
import {
    dfmRulesets,
    materials,
    processes,
    services,
    shopAccessTokens,
    shopCapabilities,
    shopRateCards,
    shopServices,
    shops,
    thicknessOptions,
} from './schema';

export const R1_RULESET_VERSION = 'dfm-2026.10-r1';
export const DEV_SHOP_ID = 'shop_philadelphia_precision';
export const DEV_RATE_CARD_ID = 'rc_philadelphia_precision_v1';
export const DEV_SHOP_TOKEN_LABEL = 'dev-console';
export const SHOP_TOKEN_PREFIX = 'dmshop';

export const PROCESS_IDS = {
    fiber: 'prc_fiber_laser',
    co2: 'prc_co2_laser',
    brake: 'prc_press_brake',
} as const;

const IN = 25.4;
const mm = (inches: number) => Math.round(inches * IN * 100) / 100;

type ThicknessSeed = {
    key: string; // id suffix
    thicknessMm: number;
    label: string;
    gaugeLabel?: string;
    feed: number; // mm/min
    pierce: number; // s
    kerf: number; // mm
    k: number;
    bendable?: boolean;
    minBendRadiusMm?: number;
    sheetPriceCents?: number;
};

type MaterialSeed = {
    id: string;
    slug: string;
    name: string;
    category: 'METAL' | 'PLASTIC' | 'WOOD';
    description: string;
    swatchHex: string;
    densityKgM3: number;
    priceBasis: 'PER_KG' | 'PER_SHEET';
    priceCentsPerKg?: number;
    sheetWidthMm?: number;
    sheetHeightMm?: number;
    scrapPct: number;
    minHoleRatio: number;
    minFeatureRatio: number;
    holeToEdgeRatio: number;
    minHoleFloorMm: number;
    minFeatureFloorMm: number;
    process: keyof typeof PROCESS_IDS;
    maxPartWidthMm: number;
    maxPartHeightMm: number;
    thicknesses: ThicknessSeed[];
};

const inch = (inches: number, extra?: string) => `${inches.toFixed(3).replace(/^0/, '')}" (${mm(inches)} mm)${extra ? ` · ${extra}` : ''}`;

/** Metal parts: max 45" x 30" (fits ground parcel + shop bed with margin). */
const METAL_MAX = { maxPartWidthMm: 1143, maxPartHeightMm: 762 };

export const MATERIAL_SEEDS: MaterialSeed[] = [
    {
        id: 'mat_al_5052',
        slug: 'aluminum-5052',
        name: 'Aluminum 5052-H32',
        category: 'METAL',
        description: 'Formable, corrosion-resistant aluminum. The default for bent brackets and enclosures.',
        swatchHex: '#c9ced3',
        densityKgM3: 2680,
        priceBasis: 'PER_KG',
        priceCentsPerKg: 950,
        scrapPct: 0.18,
        minHoleRatio: 0.75,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 0.5,
        minFeatureFloorMm: 0.5,
        process: 'fiber',
        ...METAL_MAX,
        thicknesses: [
            { key: 'al5052_040', thicknessMm: mm(0.04), label: inch(0.04), feed: 15000, pierce: 0.2, kerf: 0.15, k: 0.4, bendable: true, minBendRadiusMm: 0.76 },
            { key: 'al5052_063', thicknessMm: mm(0.063), label: inch(0.063), feed: 10000, pierce: 0.3, kerf: 0.15, k: 0.42, bendable: true, minBendRadiusMm: 1.6 },
            { key: 'al5052_080', thicknessMm: mm(0.08), label: inch(0.08), feed: 8000, pierce: 0.4, kerf: 0.18, k: 0.42, bendable: true, minBendRadiusMm: 2.0 },
            { key: 'al5052_125', thicknessMm: mm(0.125), label: inch(0.125), feed: 4500, pierce: 0.6, kerf: 0.2, k: 0.44, bendable: true, minBendRadiusMm: 3.2 },
            { key: 'al5052_190', thicknessMm: mm(0.19), label: inch(0.19), feed: 2500, pierce: 1.0, kerf: 0.25, k: 0.44, bendable: true, minBendRadiusMm: 4.8 },
            { key: 'al5052_250', thicknessMm: mm(0.25), label: inch(0.25), feed: 1500, pierce: 1.5, kerf: 0.3, k: 0.45, bendable: false },
        ],
    },
    {
        id: 'mat_al_6061',
        slug: 'aluminum-6061',
        name: 'Aluminum 6061-T6',
        category: 'METAL',
        description: 'Stronger, machinable aluminum for flat structural parts. Not bendable (T6 cracks).',
        swatchHex: '#b8bec4',
        densityKgM3: 2700,
        priceBasis: 'PER_KG',
        priceCentsPerKg: 1100,
        scrapPct: 0.18,
        minHoleRatio: 0.75,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 0.5,
        minFeatureFloorMm: 0.5,
        process: 'fiber',
        ...METAL_MAX,
        thicknesses: [
            { key: 'al6061_063', thicknessMm: mm(0.063), label: inch(0.063), feed: 9500, pierce: 0.3, kerf: 0.15, k: 0.42 },
            { key: 'al6061_090', thicknessMm: mm(0.09), label: inch(0.09), feed: 7000, pierce: 0.45, kerf: 0.18, k: 0.42 },
            { key: 'al6061_125', thicknessMm: mm(0.125), label: inch(0.125), feed: 4300, pierce: 0.6, kerf: 0.2, k: 0.44 },
            { key: 'al6061_190', thicknessMm: mm(0.19), label: inch(0.19), feed: 2400, pierce: 1.0, kerf: 0.25, k: 0.44 },
            { key: 'al6061_250', thicknessMm: mm(0.25), label: inch(0.25), feed: 1400, pierce: 1.5, kerf: 0.3, k: 0.45 },
        ],
    },
    {
        id: 'mat_steel_crs',
        slug: 'mild-steel-cr',
        name: 'Mild steel (1008 cold rolled)',
        category: 'METAL',
        description: 'Low-cost, strong, weldable steel. Powder coat it to prevent rust.',
        swatchHex: '#6f7378',
        densityKgM3: 7850,
        priceBasis: 'PER_KG',
        priceCentsPerKg: 220,
        scrapPct: 0.15,
        minHoleRatio: 1.0,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 0.5,
        minFeatureFloorMm: 0.5,
        process: 'fiber',
        ...METAL_MAX,
        thicknesses: [
            { key: 'crs_18ga', thicknessMm: 1.21, label: inch(0.048, '18 ga'), gaugeLabel: '18 ga', feed: 9000, pierce: 0.2, kerf: 0.15, k: 0.42, bendable: true, minBendRadiusMm: 1.2 },
            { key: 'crs_16ga', thicknessMm: 1.52, label: inch(0.06, '16 ga'), gaugeLabel: '16 ga', feed: 7500, pierce: 0.25, kerf: 0.15, k: 0.42, bendable: true, minBendRadiusMm: 1.5 },
            { key: 'crs_14ga', thicknessMm: 1.9, label: inch(0.075, '14 ga'), gaugeLabel: '14 ga', feed: 6000, pierce: 0.3, kerf: 0.18, k: 0.43, bendable: true, minBendRadiusMm: 1.9 },
            { key: 'crs_12ga', thicknessMm: 2.66, label: inch(0.105, '12 ga'), gaugeLabel: '12 ga', feed: 4200, pierce: 0.5, kerf: 0.2, k: 0.44, bendable: true, minBendRadiusMm: 2.7 },
            { key: 'crs_11ga', thicknessMm: 3.04, label: inch(0.12, '11 ga'), gaugeLabel: '11 ga', feed: 3600, pierce: 0.6, kerf: 0.22, k: 0.44, bendable: true, minBendRadiusMm: 3.0 },
            { key: 'crs_187', thicknessMm: mm(0.1875), label: inch(0.1875), feed: 2400, pierce: 1.0, kerf: 0.3, k: 0.45, bendable: true, minBendRadiusMm: 4.8 },
            { key: 'crs_250', thicknessMm: mm(0.25), label: inch(0.25), feed: 1800, pierce: 1.4, kerf: 0.35, k: 0.45, bendable: false },
        ],
    },
    {
        id: 'mat_ss_304',
        slug: 'stainless-304',
        name: 'Stainless steel 304 (2B)',
        category: 'METAL',
        description: 'Corrosion-resistant stainless for food, marine and outdoor parts.',
        swatchHex: '#a9adb1',
        densityKgM3: 8000,
        priceBasis: 'PER_KG',
        priceCentsPerKg: 650,
        scrapPct: 0.15,
        minHoleRatio: 1.0,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 0.5,
        minFeatureFloorMm: 0.5,
        process: 'fiber',
        ...METAL_MAX,
        thicknesses: [
            { key: 'ss304_22ga', thicknessMm: 0.76, label: inch(0.03, '22 ga'), gaugeLabel: '22 ga', feed: 14000, pierce: 0.15, kerf: 0.12, k: 0.4, bendable: true, minBendRadiusMm: 0.8 },
            { key: 'ss304_18ga', thicknessMm: 1.21, label: inch(0.048, '18 ga'), gaugeLabel: '18 ga', feed: 9000, pierce: 0.25, kerf: 0.15, k: 0.42, bendable: true, minBendRadiusMm: 1.2 },
            { key: 'ss304_16ga', thicknessMm: 1.52, label: inch(0.06, '16 ga'), gaugeLabel: '16 ga', feed: 7000, pierce: 0.3, kerf: 0.15, k: 0.43, bendable: true, minBendRadiusMm: 1.5 },
            { key: 'ss304_14ga', thicknessMm: 1.9, label: inch(0.075, '14 ga'), gaugeLabel: '14 ga', feed: 5000, pierce: 0.4, kerf: 0.18, k: 0.44, bendable: true, minBendRadiusMm: 1.9 },
            { key: 'ss304_11ga', thicknessMm: 3.05, label: inch(0.12, '11 ga'), gaugeLabel: '11 ga', feed: 2600, pierce: 0.8, kerf: 0.22, k: 0.45, bendable: true, minBendRadiusMm: 3.0 },
            { key: 'ss304_187', thicknessMm: mm(0.1875), label: inch(0.1875), feed: 1300, pierce: 1.5, kerf: 0.3, k: 0.45, bendable: false },
        ],
    },
    {
        id: 'mat_brass_260',
        slug: 'brass-260',
        name: 'Brass 260 (half hard)',
        category: 'METAL',
        description: 'Warm, decorative cartridge brass for nameplates, jewelry and trim. Flat parts only in R1.',
        swatchHex: '#c9a14a',
        densityKgM3: 8530,
        priceBasis: 'PER_KG',
        priceCentsPerKg: 1400,
        scrapPct: 0.2,
        minHoleRatio: 1.0,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 0.5,
        minFeatureFloorMm: 0.5,
        process: 'fiber',
        maxPartWidthMm: 900,
        maxPartHeightMm: 600,
        thicknesses: [
            { key: 'brass_040', thicknessMm: mm(0.04), label: inch(0.04), feed: 8000, pierce: 0.3, kerf: 0.15, k: 0.42 },
            { key: 'brass_063', thicknessMm: mm(0.063), label: inch(0.063), feed: 5000, pierce: 0.5, kerf: 0.18, k: 0.43 },
            { key: 'brass_125', thicknessMm: mm(0.125), label: inch(0.125), feed: 1800, pierce: 1.2, kerf: 0.22, k: 0.44 },
        ],
    },
    {
        id: 'mat_acrylic_black',
        slug: 'acrylic-black',
        name: 'Acrylic · gloss black (cast)',
        category: 'PLASTIC',
        description: 'Cast acrylic with flame-polished laser edges. Signs, panels and covers.',
        swatchHex: '#111214',
        densityKgM3: 1190,
        priceBasis: 'PER_SHEET',
        sheetWidthMm: 610,
        sheetHeightMm: 1220,
        scrapPct: 0.2,
        minHoleRatio: 0.5,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 1.0,
        minFeatureFloorMm: 1.5,
        process: 'co2',
        maxPartWidthMm: 1200,
        maxPartHeightMm: 600,
        thicknesses: [
            { key: 'acr_blk_3', thicknessMm: 3.0, label: '1/8" (3 mm)', feed: 1800, pierce: 0.1, kerf: 0.2, k: 0.5, sheetPriceCents: 3800 },
            { key: 'acr_blk_4p5', thicknessMm: 4.5, label: '3/16" (4.5 mm)', feed: 1200, pierce: 0.2, kerf: 0.22, k: 0.5, sheetPriceCents: 5500 },
            { key: 'acr_blk_6', thicknessMm: 6.0, label: '1/4" (6 mm)', feed: 900, pierce: 0.3, kerf: 0.25, k: 0.5, sheetPriceCents: 7200 },
        ],
    },
    {
        id: 'mat_birch_ply',
        slug: 'baltic-birch-plywood',
        name: 'Baltic birch plywood (B/BB)',
        category: 'WOOD',
        description: 'Void-free birch ply with a dark laser edge. Enclosures, jigs, models and furniture.',
        swatchHex: '#d8b98a',
        densityKgM3: 680,
        priceBasis: 'PER_SHEET',
        sheetWidthMm: 610,
        sheetHeightMm: 1220,
        scrapPct: 0.2,
        minHoleRatio: 0.5,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 1.5,
        minFeatureFloorMm: 2.0,
        process: 'co2',
        maxPartWidthMm: 1200,
        maxPartHeightMm: 600,
        thicknesses: [
            { key: 'ply_3', thicknessMm: 3.0, label: '1/8" (3 mm)', feed: 1500, pierce: 0.1, kerf: 0.2, k: 0.5, sheetPriceCents: 1400 },
            { key: 'ply_6', thicknessMm: 6.0, label: '1/4" (6 mm)', feed: 700, pierce: 0.3, kerf: 0.3, k: 0.5, sheetPriceCents: 2400 },
        ],
    },
    {
        id: 'mat_walnut',
        slug: 'hardwood-walnut',
        name: 'Hardwood · black walnut',
        category: 'WOOD',
        description: 'Solid American black walnut boards. Lamp bases, inlays, gifts.',
        swatchHex: '#5b3a29',
        densityKgM3: 610,
        priceBasis: 'PER_SHEET',
        sheetWidthMm: 305,
        sheetHeightMm: 610,
        scrapPct: 0.25,
        minHoleRatio: 0.5,
        minFeatureRatio: 1.0,
        holeToEdgeRatio: 1.0,
        minHoleFloorMm: 1.5,
        minFeatureFloorMm: 2.0,
        process: 'co2',
        maxPartWidthMm: 600,
        maxPartHeightMm: 295,
        thicknesses: [
            { key: 'walnut_3', thicknessMm: 3.2, label: '1/8" (3.2 mm)', feed: 1200, pierce: 0.2, kerf: 0.2, k: 0.5, sheetPriceCents: 2200 },
            { key: 'walnut_6', thicknessMm: 6.35, label: '1/4" (6.35 mm)', feed: 600, pierce: 0.4, kerf: 0.3, k: 0.5, sheetPriceCents: 3400 },
        ],
    },
];

const BENDABLE_METALS = ['aluminum-5052', 'mild-steel-cr', 'stainless-304'];
const COATABLE_METALS = ['aluminum-5052', 'aluminum-6061', 'mild-steel-cr', 'stainless-304'];
const ANODIZABLE = ['aluminum-5052', 'aluminum-6061'];
const ALL_METALS = ['aluminum-5052', 'aluminum-6061', 'mild-steel-cr', 'stainless-304', 'brass-260'];

type ServiceSeed = typeof services.$inferInsert & { id: string };

export const SERVICE_SEEDS: ServiceSeed[] = [
    {
        id: 'svc_bending',
        slug: 'bending',
        name: 'Press brake bending',
        kind: 'SECONDARY_OP',
        pricingUnit: 'PER_FEATURE',
        description: 'CNC press brake bending along the bend lines in your file (layer "BEND"). Priced per bend from the shop rate card.',
        unitPriceCents: 250,
        batchSetupCents: 2000,
        requiresFeatureCount: false,
        compatibleCategories: ['METAL'],
        compatibleMaterialSlugs: BENDABLE_METALS,
        options: {},
        leadTimeDaysAdded: 1,
        sortOrder: 10,
    },
    {
        id: 'svc_tapping',
        slug: 'tapping',
        name: 'Tapping',
        kind: 'SECONDARY_OP',
        pricingUnit: 'PER_FEATURE',
        description: 'Cut threads into holes sized to the tap drill for the selected thread.',
        unitPriceCents: 175,
        requiresFeatureCount: true,
        compatibleCategories: ['METAL'],
        compatibleMaterialSlugs: ALL_METALS,
        options: { threads: ['M3', 'M4', 'M5', 'M6', '#4-40', '#6-32', '#8-32', '#10-24', '#10-32', '1/4-20'] },
        leadTimeDaysAdded: 1,
        sortOrder: 20,
    },
    {
        id: 'svc_countersink',
        slug: 'countersinking',
        name: 'Countersinking',
        kind: 'SECONDARY_OP',
        pricingUnit: 'PER_FEATURE',
        description: 'Countersink holes so flat-head screws sit flush.',
        unitPriceCents: 150,
        requiresFeatureCount: true,
        compatibleCategories: ['METAL'],
        compatibleMaterialSlugs: ALL_METALS,
        options: { angles: ['82°', '90°', '100°'] },
        leadTimeDaysAdded: 1,
        sortOrder: 30,
    },
    {
        id: 'svc_pem',
        slug: 'pem-hardware',
        name: 'PEM hardware insertion',
        kind: 'SECONDARY_OP',
        pricingUnit: 'PER_FEATURE',
        description: 'Press-fit self-clinching nuts, studs and standoffs (hardware included).',
        unitPriceCents: 95,
        requiresFeatureCount: true,
        compatibleCategories: ['METAL'],
        compatibleMaterialSlugs: ['aluminum-5052', 'aluminum-6061', 'mild-steel-cr', 'stainless-304'],
        options: { hardware: ['S-M3-1 nut', 'S-M4-1 nut', 'S-632-1 nut', 'SO-M3-6 standoff', 'FH-M4-10 stud'] },
        leadTimeDaysAdded: 2,
        sortOrder: 40,
    },
    {
        id: 'svc_deburr',
        slug: 'deburring',
        name: 'Deburring',
        kind: 'SECONDARY_OP',
        pricingUnit: 'PER_PART',
        description: 'Linear deburring removes sharp laser dross and edge burrs.',
        unitPriceCents: 60,
        requiresFeatureCount: false,
        compatibleCategories: ['METAL'],
        compatibleMaterialSlugs: ALL_METALS,
        options: {},
        leadTimeDaysAdded: 0,
        sortOrder: 50,
    },
    ...(
        [
            ['svc_powder_black_matte', 'powder-coat-matte-black', 'Powder coat · matte black', 'Matte black (RAL 9005)', '#151515'],
            ['svc_powder_white_gloss', 'powder-coat-gloss-white', 'Powder coat · gloss white', 'Gloss white (RAL 9003)', '#f4f4f0'],
            ['svc_powder_signal_red', 'powder-coat-signal-red', 'Powder coat · signal red', 'Signal red (RAL 3001)', '#9b2423'],
            ['svc_powder_signal_blue', 'powder-coat-signal-blue', 'Powder coat · signal blue', 'Signal blue (RAL 5005)', '#1e3c74'],
            ['svc_powder_textured_graphite', 'powder-coat-textured-graphite', 'Powder coat · textured graphite', 'Textured graphite (RAL 7024)', '#474a50'],
        ] as const
    ).map(
        ([id, slug, name, colorName, colorHex], i): ServiceSeed => ({
            id,
            slug,
            name,
            kind: 'FINISH',
            pricingUnit: 'PER_AREA_FT2',
            description: 'Durable electrostatic powder coat, both sides, oven cured.',
            unitPriceCents: 350,
            batchSetupCents: 3500,
            minimumCents: 2500,
            colorName,
            colorHex,
            requiresFeatureCount: false,
            compatibleCategories: ['METAL'],
            compatibleMaterialSlugs: COATABLE_METALS,
            options: {},
            leadTimeDaysAdded: 3,
            sortOrder: 100 + i,
        }),
    ),
    ...(
        [
            ['svc_anodize_clear', 'anodize-type2-clear', 'Anodize Type II · clear', 'Clear', '#d9dde1'],
            ['svc_anodize_black', 'anodize-type2-black', 'Anodize Type II · black', 'Black', '#1b1c1e'],
        ] as const
    ).map(
        ([id, slug, name, colorName, colorHex], i): ServiceSeed => ({
            id,
            slug,
            name,
            kind: 'FINISH',
            pricingUnit: 'PER_AREA_FT2',
            description: 'MIL-A-8625 Type II sulfuric anodize. Aluminum only.',
            unitPriceCents: 450,
            batchSetupCents: 4500,
            minimumCents: 3500,
            colorName,
            colorHex,
            requiresFeatureCount: false,
            compatibleCategories: ['METAL'],
            compatibleMaterialSlugs: ANODIZABLE,
            options: {},
            leadTimeDaysAdded: 3,
            sortOrder: 200 + i,
        }),
    ),
];

/** DFM thresholds as data (workflow 02). Ratios multiply material thickness. */
export const R1_DFM_RULES = {
    weights: { BLOCKING: 30, WARNING: 8 },
    rules: {
        open_contour: { severity: 'BLOCKING', closeToleranceMm: 0.01 },
        part_size_max: { severity: 'BLOCKING', source: 'thickness_options.max_part_*_mm' },
        part_size_min: { severity: 'BLOCKING', minMm: 10 },
        min_hole_diameter: { severity: 'BLOCKING', source: 'materials.min_hole_ratio x t, floor materials.min_hole_floor_mm' },
        min_feature: { severity: 'BLOCKING', source: 'materials.min_feature_ratio x t, floor materials.min_feature_floor_mm' },
        hole_to_edge: { severity: 'WARNING', blockingBelowRatio: 0.5, source: 'materials.hole_to_edge_ratio x t' },
        bend_flange_min: { severity: 'BLOCKING', source: 'thickness_options.min_flange_ratio x t' },
        hole_to_bend: { severity: 'WARNING', ratio: 2.5, addBendRadius: true },
        bend_not_supported: { severity: 'BLOCKING', when: 'bend lines present and thickness option not bendable or no bending service' },
        text_entities: { severity: 'WARNING', message: 'Convert text to outlines or a stencil font' },
    },
};

export const DEV_SHOP_ADDRESS: Address = {
    name: 'Philadelphia Precision Works',
    company: 'Philadelphia Precision Works (dev partner fixture)',
    line1: '1600 N 5th St',
    city: 'Philadelphia',
    region: 'PA',
    postalCode: '19122',
    country: 'US',
    phone: '+1 215 555 0142',
};

export type SeedOptions = {
    /** Use this exact Shop Console token (e2e / tests). Default: env SEED_SHOP_TOKEN, else generate once. */
    shopToken?: string;
    /** Print progress. Default false. */
    log?: boolean;
};

export type SeedResult = {
    materials: number;
    thicknessOptions: number;
    services: number;
    shopId: string;
    rateCardId: string;
    rulesetVersion: string;
    /** Plaintext token when one was created/set during this run; null when an existing token was kept. */
    shopToken: string | null;
};

const excluded = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, sql.raw(`excluded."${c.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}"`)]));

export async function seed(db: Db = getDb(), opts: SeedOptions = {}): Promise<SeedResult> {
    const log = (msg: string) => opts.log && console.log(`[db:seed] ${msg}`);

    return db.transaction(async (tx) => {
        // Processes
        const processRows = [
            { id: PROCESS_IDS.fiber, slug: 'fiber-laser', name: 'Fiber laser cutting', kind: 'FIBER_LASER' as const, description: 'Metal sheet cutting, 4 kW fiber source, N2/O2 assist.' },
            { id: PROCESS_IDS.co2, slug: 'co2-laser', name: 'CO₂ laser cutting', kind: 'CO2_LASER' as const, description: 'Acrylic and wood cutting, 150 W CO₂ source.' },
            { id: PROCESS_IDS.brake, slug: 'press-brake', name: 'Press brake bending', kind: 'PRESS_BRAKE' as const, description: 'CNC press brake, sheet metals up to 4.8 mm.' },
        ];
        await tx
            .insert(processes)
            .values(processRows)
            .onConflictDoUpdate({ target: processes.id, set: excluded(['slug', 'name', 'kind', 'description']) });

        // Materials + thickness options
        let thicknessCount = 0;
        for (const [i, m] of MATERIAL_SEEDS.entries()) {
            const row = {
                id: m.id,
                slug: m.slug,
                name: m.name,
                category: m.category,
                description: m.description,
                swatchHex: m.swatchHex,
                densityKgM3: m.densityKgM3,
                priceBasis: m.priceBasis,
                priceCentsPerKg: m.priceCentsPerKg ?? null,
                sheetWidthMm: m.sheetWidthMm ?? null,
                sheetHeightMm: m.sheetHeightMm ?? null,
                scrapPct: m.scrapPct,
                minHoleRatio: m.minHoleRatio,
                minFeatureRatio: m.minFeatureRatio,
                holeToEdgeRatio: m.holeToEdgeRatio,
                minHoleFloorMm: m.minHoleFloorMm,
                minFeatureFloorMm: m.minFeatureFloorMm,
                calibrated: false,
                active: true,
                sortOrder: i * 10,
            };
            await tx
                .insert(materials)
                .values(row)
                .onConflictDoUpdate({ target: materials.id, set: excluded(Object.keys(row).filter((k) => k !== 'id')) });

            for (const t of m.thicknesses) {
                const trow = {
                    id: `thk_${t.key}`,
                    materialId: m.id,
                    processId: PROCESS_IDS[m.process],
                    thicknessMm: t.thicknessMm,
                    label: t.label,
                    gaugeLabel: t.gaugeLabel ?? null,
                    feedRateMmPerMin: t.feed,
                    pierceTimeS: t.pierce,
                    kerfMm: t.kerf,
                    kFactor: t.k,
                    bendable: t.bendable ?? false,
                    minBendRadiusMm: t.minBendRadiusMm ?? null,
                    minFlangeRatio: 4,
                    sheetPriceCents: t.sheetPriceCents ?? null,
                    maxPartWidthMm: m.maxPartWidthMm,
                    maxPartHeightMm: m.maxPartHeightMm,
                    calibrated: false,
                    active: true,
                };
                await tx
                    .insert(thicknessOptions)
                    .values(trow)
                    .onConflictDoUpdate({ target: thicknessOptions.id, set: excluded(Object.keys(trow).filter((k) => k !== 'id')) });
                thicknessCount++;
            }
        }
        log(`${MATERIAL_SEEDS.length} materials, ${thicknessCount} thickness options`);

        // Services
        for (const s of SERVICE_SEEDS) {
            const row = { batchSetupCents: 0, minimumCents: 0, colorName: null, colorHex: null, calibrated: false, active: true, ...s };
            await tx
                .insert(services)
                .values(row)
                .onConflictDoUpdate({ target: services.id, set: excluded(Object.keys(row).filter((k) => k !== 'id')) });
        }
        log(`${SERVICE_SEEDS.length} services`);

        // DFM ruleset
        await tx
            .insert(dfmRulesets)
            .values({ version: R1_RULESET_VERSION, rules: R1_DFM_RULES, active: true, notes: 'R1 default thresholds (to be calibrated)' })
            .onConflictDoUpdate({ target: dfmRulesets.version, set: { rules: R1_DFM_RULES, active: true } });

        // Dev partner shop
        const shopRow = {
            id: DEV_SHOP_ID,
            slug: 'philadelphia-precision-works',
            name: 'Philadelphia Precision Works',
            legalName: 'Philadelphia Precision Works (dev partner fixture)',
            status: 'ACTIVE' as const,
            contactEmail: 'shop-dev@discovermake.local',
            phone: DEV_SHOP_ADDRESS.phone ?? null,
            address: DEV_SHOP_ADDRESS,
            city: 'Philadelphia',
            region: 'PA',
            country: 'US',
            timezone: 'America/New_York',
            lat: 39.9757,
            lng: -75.1443,
            rating: null,
            ratingCount: 0,
            queueDays: 2,
            acceptWindowMinutes: 120,
            adapterLevel: 'L1',
            certifications: [] as string[],
        };
        await tx
            .insert(shops)
            .values(shopRow)
            .onConflictDoUpdate({ target: shops.id, set: excluded(Object.keys(shopRow).filter((k) => k !== 'id')) });

        // Capabilities: fiber for metals, CO2 for acrylic/wood, press brake for bendable metal options.
        const allThickness = MATERIAL_SEEDS.flatMap((m) => m.thicknesses.map((t) => ({ m, t })));
        const capRows = allThickness.flatMap(({ m, t }) => {
            const rows: (typeof shopCapabilities.$inferInsert)[] = [
                {
                    id: `cap_ppw_${t.key}_${m.process}`,
                    shopId: DEV_SHOP_ID,
                    materialId: m.id,
                    thicknessOptionId: `thk_${t.key}`,
                    processId: PROCESS_IDS[m.process],
                    bedWidthMm: m.process === 'fiber' ? 1524 : 1300,
                    bedHeightMm: m.process === 'fiber' ? 3048 : 2500,
                    maxBendLengthMm: null,
                    machineLabel: m.process === 'fiber' ? 'Fiber laser 04 (4 kW)' : 'CO₂ laser 02 (150 W)',
                    active: true,
                },
            ];
            if (t.bendable && BENDABLE_METALS.includes(m.slug)) {
                rows.push({
                    id: `cap_ppw_${t.key}_brake`,
                    shopId: DEV_SHOP_ID,
                    materialId: m.id,
                    thicknessOptionId: `thk_${t.key}`,
                    processId: PROCESS_IDS.brake,
                    bedWidthMm: 1250,
                    bedHeightMm: 1250,
                    maxBendLengthMm: 1250,
                    machineLabel: 'Press brake 01 (100 t, 1.25 m)',
                    active: true,
                });
            }
            return rows;
        });
        for (const c of capRows) {
            await tx
                .insert(shopCapabilities)
                .values(c)
                .onConflictDoUpdate({ target: shopCapabilities.id, set: excluded(Object.keys(c).filter((k) => k !== 'id')) });
        }
        log(`${capRows.length} shop capabilities`);

        // Services the dev shop performs: every seeded secondary op and finish.
        for (const svc of SERVICE_SEEDS) {
            const row = { id: `ssv_ppw_${svc.id.replace(/^svc_/, '')}`, shopId: DEV_SHOP_ID, serviceId: svc.id, active: true };
            await tx
                .insert(shopServices)
                .values(row)
                .onConflictDoUpdate({ target: shopServices.id, set: { shopId: row.shopId, serviceId: row.serviceId, active: true } });
        }
        log(`${SERVICE_SEEDS.length} shop services`);

        // Rate card (defaults to be calibrated)
        const rateRow = {
            id: DEV_RATE_CARD_ID,
            shopId: DEV_SHOP_ID,
            version: 1,
            active: true,
            currency: 'usd',
            fiberLaserCentsPerHour: 15000,
            co2LaserCentsPerHour: 9000,
            brakeCentsPerBend: 250,
            brakeSetupCents: 2000,
            orderSetupCents: 1500,
            partHandlingCents: 50,
            finishingCentsPerFt2: 350,
            finishBatchSetupCents: 3500,
            qaCentsPerPart: 25,
            packagingBaseCents: 400,
            materialMarkup: 1.1,
            platformMarginPct: 0.35,
            minimumOrderCents: 2900,
            volumeDiscountMax: 0.25,
            serviceOverrides: {} as Record<string, number>,
            calibrated: false,
            notes: 'Default coefficients for dev. Calibrate weekly against shop invoices (golden-part suite).',
        };
        await tx
            .insert(shopRateCards)
            .values(rateRow)
            .onConflictDoUpdate({ target: shopRateCards.id, set: excluded(Object.keys(rateRow).filter((k) => k !== 'id')) });

        // Shop Console token (hash only)
        const requested = opts.shopToken ?? process.env.SEED_SHOP_TOKEN?.trim() ?? '';
        let shopToken: string | null = null;
        const [existing] = await tx
            .select({ id: shopAccessTokens.id, tokenHash: shopAccessTokens.tokenHash })
            .from(shopAccessTokens)
            .where(and(eq(shopAccessTokens.shopId, DEV_SHOP_ID), eq(shopAccessTokens.label, DEV_SHOP_TOKEN_LABEL)));
        if (requested) {
            const tokenHash = sha256Hex(requested);
            if (existing) {
                if (existing.tokenHash !== tokenHash) {
                    await tx.update(shopAccessTokens).set({ tokenHash, revokedAt: null }).where(eq(shopAccessTokens.id, existing.id));
                }
            } else {
                await tx.insert(shopAccessTokens).values({ id: 'stk_ppw_dev', shopId: DEV_SHOP_ID, tokenHash, label: DEV_SHOP_TOKEN_LABEL });
            }
            shopToken = requested;
        } else if (!existing) {
            shopToken = generateToken(SHOP_TOKEN_PREFIX);
            await tx.insert(shopAccessTokens).values({ id: 'stk_ppw_dev', shopId: DEV_SHOP_ID, tokenHash: sha256Hex(shopToken), label: DEV_SHOP_TOKEN_LABEL });
        }

        return {
            materials: MATERIAL_SEEDS.length,
            thicknessOptions: thicknessCount,
            services: SERVICE_SEEDS.length,
            shopId: DEV_SHOP_ID,
            rateCardId: DEV_RATE_CARD_ID,
            rulesetVersion: R1_RULESET_VERSION,
            shopToken,
        };
    });
}
