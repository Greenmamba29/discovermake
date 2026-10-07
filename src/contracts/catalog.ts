/**
 * Catalog contracts: what a buyer can configure.
 * GET /api/catalog -> CatalogResponse
 *
 * Buyer-facing: exposes options and labels, NOT shop cost coefficients.
 */
import { z } from 'zod';
import { MaterialCategory, ProcessKind, ServiceKind, ServicePricingUnit } from './enums';
import { MaterialId, ProcessId, ServiceId, ThicknessOptionId } from './common';

export const CatalogThicknessOption = z.object({
    id: ThicknessOptionId,
    thicknessMm: z.number().positive(),
    /** e.g. `0.063" (16 ga)` or `3 mm` */
    label: z.string(),
    processId: ProcessId,
    bendable: z.boolean(),
    /** Largest part this option can be cut at across active shops (mm). */
    maxPartWidthMm: z.number().positive(),
    maxPartHeightMm: z.number().positive(),
    /** DFM minimums already resolved to mm for this thickness. */
    minHoleDiameterMm: z.number().positive(),
    minFeatureMm: z.number().positive(),
    minHoleToEdgeMm: z.number().positive(),
});
export type CatalogThicknessOption = z.infer<typeof CatalogThicknessOption>;

export const CatalogMaterial = z.object({
    id: MaterialId,
    slug: z.string(),
    name: z.string(),
    category: MaterialCategory,
    description: z.string(),
    /** Swatch color for UI chips until texture photos land. */
    swatchHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Service ids (finishes + secondary ops) compatible with this material. */
    compatibleServiceIds: z.array(ServiceId),
    thicknessOptions: z.array(CatalogThicknessOption).min(1),
});
export type CatalogMaterial = z.infer<typeof CatalogMaterial>;

export const CatalogProcess = z.object({
    id: ProcessId,
    slug: z.string(),
    name: z.string(),
    kind: ProcessKind,
});
export type CatalogProcess = z.infer<typeof CatalogProcess>;

export const CatalogService = z.object({
    id: ServiceId,
    slug: z.string(),
    name: z.string(),
    kind: ServiceKind,
    pricingUnit: ServicePricingUnit,
    description: z.string(),
    /** Finishes only: display color. */
    colorName: z.string().nullable(),
    colorHex: z.string().nullable(),
    /** SECONDARY_OP: true when the buyer must give a per-part feature count (e.g. number of tapped holes). */
    requiresFeatureCount: z.boolean(),
    /** Free-form options, e.g. thread sizes for tapping: `{ threads: ["M3","M4","#6-32"] }`. */
    options: z.record(z.unknown()),
    leadTimeDaysAdded: z.number().int().nonnegative(),
});
export type CatalogService = z.infer<typeof CatalogService>;

export const CatalogResponse = z.object({
    materials: z.array(CatalogMaterial),
    processes: z.array(CatalogProcess),
    services: z.array(CatalogService),
    /** Quantities shown on the price ladder. */
    ladderQuantities: z.array(z.number().int().positive()),
    rulesetVersion: z.string(),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;
