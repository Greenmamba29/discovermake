/**
 * Catalog + rule-set loading for the quote engine (read-only DB access).
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { CatalogMaterial, CatalogResponse, CatalogThicknessOption } from '../../contracts/catalog';
import type { DbOrTx } from '../db';
import { dfmRulesets, materials, processes, services, shopCapabilities, shopRateCards, shops, thicknessOptions } from '../db/schema';
import { dfmThresholds, resolveRuleset, type DfmMaterial, type DfmRuleset, type DfmThickness, type SizeLimit } from './dfm';
import { QUOTE_LADDER_QUANTITIES } from './pricing';

export type MaterialRow = typeof materials.$inferSelect;
export type ThicknessRow = typeof thicknessOptions.$inferSelect;
export type ServiceRow = typeof services.$inferSelect;
export type ProcessRow = typeof processes.$inferSelect;

/** Fallback when no ruleset row is active (never expected after seeding). */
export const BUILTIN_RULESET_VERSION = 'dfm-builtin-r1';

export async function loadActiveRuleset(db: DbOrTx): Promise<DfmRuleset> {
    const [row] = await db.select().from(dfmRulesets).where(eq(dfmRulesets.active, true)).orderBy(desc(dfmRulesets.createdAt)).limit(1);
    return row ? resolveRuleset(row.version, row.rules) : resolveRuleset(BUILTIN_RULESET_VERSION, null);
}

export async function loadRuleset(db: DbOrTx, version: string | null): Promise<DfmRuleset> {
    if (!version) return loadActiveRuleset(db);
    if (version === BUILTIN_RULESET_VERSION) return resolveRuleset(version, null);
    const [row] = await db.select().from(dfmRulesets).where(eq(dfmRulesets.version, version)).limit(1);
    return row ? resolveRuleset(row.version, row.rules) : loadActiveRuleset(db);
}

/** Every active thickness option's max part size (geometry-only "fits anything?" check). */
export async function loadCatalogLimits(db: DbOrTx): Promise<SizeLimit[]> {
    const rows = await db
        .select({ w: thicknessOptions.maxPartWidthMm, h: thicknessOptions.maxPartHeightMm })
        .from(thicknessOptions)
        .innerJoin(materials, eq(materials.id, thicknessOptions.materialId))
        .where(and(eq(thicknessOptions.active, true), eq(materials.active, true)));
    return rows.map((r) => ({ widthMm: r.w, heightMm: r.h }));
}

/** Intersect a part-size limit with a machine bed (both orientation-free). */
export function limitWithin(a: SizeLimit, b: SizeLimit): SizeLimit {
    const aL = Math.max(a.widthMm, a.heightMm);
    const aS = Math.min(a.widthMm, a.heightMm);
    const bL = Math.max(b.widthMm, b.heightMm);
    const bS = Math.min(b.widthMm, b.heightMm);
    return { widthMm: Math.min(aL, bL), heightMm: Math.min(aS, bS) };
}

export function serviceCompatible(s: Pick<ServiceRow, 'compatibleMaterialSlugs' | 'compatibleCategories'>, m: Pick<MaterialRow, 'slug' | 'category'>): boolean {
    if (s.compatibleMaterialSlugs.length) return s.compatibleMaterialSlugs.includes(m.slug);
    return s.compatibleCategories.includes(m.category);
}

export function toDfmMaterial(m: MaterialRow): DfmMaterial {
    return {
        name: m.name,
        minHoleRatio: m.minHoleRatio,
        minFeatureRatio: m.minFeatureRatio,
        holeToEdgeRatio: m.holeToEdgeRatio,
        minHoleFloorMm: m.minHoleFloorMm,
        minFeatureFloorMm: m.minFeatureFloorMm,
    };
}

export function toDfmThickness(t: ThicknessRow): DfmThickness {
    return {
        id: t.id,
        label: t.label,
        thicknessMm: t.thicknessMm,
        bendable: t.bendable,
        minBendRadiusMm: t.minBendRadiusMm,
        minFlangeRatio: t.minFlangeRatio,
        maxPartWidthMm: t.maxPartWidthMm,
        maxPartHeightMm: t.maxPartHeightMm,
    };
}

/** Largest bed per (thickness option, process) across ACTIVE shops that have an active rate card. */
async function loadBedLimits(db: DbOrTx): Promise<Map<string, SizeLimit>> {
    const rows = await db
        .select({
            thicknessOptionId: shopCapabilities.thicknessOptionId,
            processId: shopCapabilities.processId,
            bedWidthMm: shopCapabilities.bedWidthMm,
            bedHeightMm: shopCapabilities.bedHeightMm,
        })
        .from(shopCapabilities)
        .innerJoin(shops, eq(shops.id, shopCapabilities.shopId))
        .innerJoin(shopRateCards, and(eq(shopRateCards.shopId, shops.id), eq(shopRateCards.active, true)))
        .where(and(eq(shopCapabilities.active, true), eq(shops.status, 'ACTIVE')));
    const out = new Map<string, SizeLimit>();
    for (const r of rows) {
        const key = `${r.thicknessOptionId}|${r.processId}`;
        const prev = out.get(key);
        if (!prev || r.bedWidthMm * r.bedHeightMm > prev.widthMm * prev.heightMm) out.set(key, { widthMm: r.bedWidthMm, heightMm: r.bedHeightMm });
    }
    return out;
}

/** Buyer-safe catalog: options that at least one active shop can make; no shop costs. */
export async function buildCatalog(db: DbOrTx): Promise<CatalogResponse> {
    const [ruleset, materialRows, thicknessRows, processRows, serviceRows, beds] = await Promise.all([
        loadActiveRuleset(db),
        db.select().from(materials).where(eq(materials.active, true)).orderBy(asc(materials.sortOrder), asc(materials.name)),
        db.select().from(thicknessOptions).where(eq(thicknessOptions.active, true)).orderBy(asc(thicknessOptions.thicknessMm)),
        db.select().from(processes).where(eq(processes.active, true)).orderBy(asc(processes.name)),
        db.select().from(services).where(eq(services.active, true)).orderBy(asc(services.sortOrder), asc(services.name)),
        loadBedLimits(db),
    ]);

    const catalogMaterials: CatalogMaterial[] = [];
    for (const m of materialRows) {
        const options: CatalogThicknessOption[] = [];
        for (const t of thicknessRows) {
            if (t.materialId !== m.id) continue;
            const bed = beds.get(`${t.id}|${t.processId}`);
            if (!bed) continue; // nobody can cut it right now
            const limit = limitWithin({ widthMm: t.maxPartWidthMm, heightMm: t.maxPartHeightMm }, bed);
            const th = dfmThresholds(toDfmMaterial(m), toDfmThickness(t), ruleset);
            options.push({
                id: t.id,
                thicknessMm: t.thicknessMm,
                label: t.label,
                processId: t.processId,
                bendable: t.bendable,
                maxPartWidthMm: limit.widthMm,
                maxPartHeightMm: limit.heightMm,
                minHoleDiameterMm: th.minHoleDiameterMm,
                minFeatureMm: th.minFeatureMm,
                minHoleToEdgeMm: th.minHoleToEdgeMm,
            });
        }
        if (!options.length) continue;
        catalogMaterials.push({
            id: m.id,
            slug: m.slug,
            name: m.name,
            category: m.category,
            description: m.description,
            swatchHex: /^#[0-9a-fA-F]{6}$/.test(m.swatchHex) ? m.swatchHex : '#9aa0a6',
            compatibleServiceIds: serviceRows.filter((s) => serviceCompatible(s, m)).map((s) => s.id),
            thicknessOptions: options,
        });
    }

    return {
        materials: catalogMaterials,
        processes: processRows.map((p) => ({ id: p.id, slug: p.slug, name: p.name, kind: p.kind })),
        services: serviceRows.map((s) => ({
            id: s.id,
            slug: s.slug,
            name: s.name,
            kind: s.kind,
            pricingUnit: s.pricingUnit,
            description: s.description,
            colorName: s.colorName,
            colorHex: s.colorHex,
            requiresFeatureCount: s.requiresFeatureCount,
            options: s.options,
            leadTimeDaysAdded: s.leadTimeDaysAdded,
        })),
        ladderQuantities: [...QUOTE_LADDER_QUANTITIES],
        rulesetVersion: ruleset.version,
    };
}

export async function loadServices(db: DbOrTx, ids: string[]): Promise<ServiceRow[]> {
    if (!ids.length) return [];
    return db.select().from(services).where(inArray(services.id, ids));
}
