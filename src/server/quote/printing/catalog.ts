/**
 * Print catalog + the dev partner's printers and print rate card (R6).
 *
 * Follows the shop model of the sheet catalog: materials (`print_materials`), what a shop can
 * run (`shop_print_capabilities`: shop x material with the printer's build volume) and how it
 * prices (`shop_print_rate_cards`, one active per shop). Money is USD cents. Every number is an
 * uncalibrated default (owner input: calibrate against print-farm invoices, see
 * docs/architecture/r6-reconstruct.md).
 */
import { and, asc, eq } from 'drizzle-orm';
import type { PrintMaterialOption } from '../../../contracts/reconstruct';
import type { DbOrTx } from '../../db';
import { printMaterials, shopPrintCapabilities, shopPrintRateCards } from '../../db/schema';
import type { PrintProcess } from './pricing';

/**
 * Layer profiles a print quote's `config.thicknessOptionId` names (print quotes have no sheet
 * thickness; these ids live only in the print catalog, never in `thickness_options`).
 */
export const PRINT_PROFILES: Record<PrintProcess, { id: string; label: string; processName: string }> = {
    FDM: { id: 'thk_print_fdm_020', label: '0.20 mm layers (FDM)', processName: 'FDM 3D printing' },
    SLS: { id: 'thk_print_sls_010', label: '0.10 mm layers (SLS)', processName: 'SLS 3D printing' },
};

export const PRINT_MATERIAL_SEEDS = [
    {
        id: 'mat_print_pla',
        slug: 'pla',
        name: 'PLA',
        description: 'Stiff, easy, indoor parts. Softens above about 55 °C: not for stoves or cars.',
        swatchHex: '#e8e4da',
        process: 'FDM',
        densityKgM3: 1240,
        priceCentsPerKg: 2500,
        minWallMm: 1.2,
        maxBridgeMm: 10,
        heatDeflectionC: 55,
    },
    {
        id: 'mat_print_petg',
        slug: 'petg',
        name: 'PETG',
        description: 'Tough and a little flexible; good everyday replacement parts up to about 70 °C.',
        swatchHex: '#2b2f36',
        process: 'FDM',
        densityKgM3: 1270,
        priceCentsPerKg: 2800,
        minWallMm: 1.2,
        maxBridgeMm: 10,
        heatDeflectionC: 70,
    },
    {
        id: 'mat_print_asa',
        slug: 'asa',
        name: 'ASA',
        description: 'UV and heat resistant (about 95 °C): outdoor parts, appliance and stove knobs.',
        swatchHex: '#1d1f23',
        process: 'FDM',
        densityKgM3: 1070,
        priceCentsPerKg: 3500,
        minWallMm: 1.2,
        maxBridgeMm: 8,
        heatDeflectionC: 95,
    },
    {
        id: 'mat_print_pa12',
        slug: 'nylon-pa12',
        name: 'Nylon PA12',
        description: 'SLS nylon: strong, wear resistant and heat tolerant (about 175 °C); no supports needed.',
        swatchHex: '#9a9b97',
        process: 'SLS',
        densityKgM3: 1010,
        priceCentsPerKg: 9000,
        minWallMm: 1.0,
        maxBridgeMm: 1000,
        heatDeflectionC: 175,
    },
] as const;

export const DEV_PRINT_RATE_CARD_ID = 'prcard_philadelphia_precision_v1';

/** The dev partner's printers: an FDM farm (Prusa MK4 class) and one SLS printer (Fuse 1 class). */
export function devPrintCapabilities(shopId: string) {
    const fdm = { buildXMm: 250, buildYMm: 210, buildZMm: 220, printerCount: 6, machineLabel: 'FDM farm (6 x 250 x 210 x 220 mm)' };
    const sls = { buildXMm: 165, buildYMm: 165, buildZMm: 300, printerCount: 1, machineLabel: 'SLS printer (165 x 165 x 300 mm)' };
    return PRINT_MATERIAL_SEEDS.map((m) => ({ id: `pcap_ppw_${m.slug.replace(/-/g, '_')}`, shopId, printMaterialId: m.id, capability: '3D_PRINT', ...(m.process === 'SLS' ? sls : fdm), active: true }));
}

export function devPrintRateCard(shopId: string) {
    return {
        id: DEV_PRINT_RATE_CARD_ID,
        shopId,
        version: 1,
        active: true,
        currency: 'usd',
        fdmCentsPerHour: 300,
        fdmMm3PerHour: 10_800,
        fdmLayerHeightMm: 0.2,
        fdmLayerSeconds: 4,
        slsCentsPerHour: 1200,
        slsMm3PerHour: 30_000,
        slsLayerHeightMm: 0.1,
        slsLayerSeconds: 0,
        shellMm: 1.2,
        infillPct: 0.4,
        orderSetupCents: 800,
        postProcessCentsPerPart: 150,
        qaCentsPerPart: 50,
        partHandlingCents: 30,
        packagingBaseCents: 300,
        materialMarkup: 1.15,
        materialWastePct: 0.1,
        platformMarginPct: 0.35,
        minMarginPct: 0.15,
        volumeDiscountMax: 0.5,
        minimumOrderCents: 1900,
        printerHoursPerDay: 20,
        calibrated: false,
        notes: 'R6 default print coefficients for dev. Calibrate against print-farm invoices before GA.',
    };
}

export async function listPrintMaterials(db: DbOrTx): Promise<PrintMaterialOption[]> {
    const rows = await db.select().from(printMaterials).where(eq(printMaterials.active, true)).orderBy(asc(printMaterials.sortOrder), asc(printMaterials.name));
    return rows.map((r) => ({ slug: r.slug, name: r.name, process: r.process, description: r.description, swatchHex: r.swatchHex, heatDeflectionC: r.heatDeflectionC ?? null }));
}

export async function loadPrintMaterialBySlug(db: DbOrTx, slug: string) {
    const [row] = await db
        .select()
        .from(printMaterials)
        .where(and(eq(printMaterials.slug, slug), eq(printMaterials.active, true)));
    return row ?? null;
}

/** Print catalog seed (catalog part: materials). Idempotent. */
export async function seedPrintCatalog(tx: DbOrTx): Promise<number> {
    for (const [i, m] of PRINT_MATERIAL_SEEDS.entries()) {
        const row = { ...m, calibrated: false, active: true, sortOrder: i * 10 };
        const { id: _id, ...set } = row;
        await tx.insert(printMaterials).values(row).onConflictDoUpdate({ target: printMaterials.id, set });
    }
    return PRINT_MATERIAL_SEEDS.length;
}

/** The dev partner's print capability + print rate card. Idempotent. */
export async function seedPrintShop(tx: DbOrTx, shopId: string): Promise<{ capabilities: number; rateCardId: string }> {
    const caps = devPrintCapabilities(shopId);
    for (const c of caps) {
        const { id: _id, ...set } = c;
        await tx.insert(shopPrintCapabilities).values(c).onConflictDoUpdate({ target: shopPrintCapabilities.id, set });
    }
    const card = devPrintRateCard(shopId);
    const { id: _id, ...set } = card;
    await tx.insert(shopPrintRateCards).values(card).onConflictDoUpdate({ target: shopPrintRateCards.id, set });
    return { capabilities: caps.length, rateCardId: card.id };
}
