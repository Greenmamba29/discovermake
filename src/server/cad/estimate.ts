/**
 * Preliminary estimate for a CAD version (workflow 01 artifacts 8-10: Makeability score,
 * price range, production time), computed ONLY by the R1 quote engine.
 *
 * For every candidate catalog material that stocks the spec's sheet thickness (the build's
 * MATERIAL nodes first: recommended, alternatives, candidates), each flat-pattern part is
 * quoted at (builds x pieces per build), with press-brake bending when it has bend lines and
 * countersinking for slotted plates. The quotes are real, persisted snapshots (BINDING when
 * the engine can price the part). The range spans the candidate materials; production time is
 * the slowest panel's lead time. Purchased hardware stays in the BOM, unpriced.
 *
 * Quantity is the buyer's stated quantity (a user-sourced quantity requirement); without one
 * the estimate is for a single build and says so (`quantitySource: "default"`).
 */
import 'server-only';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import type { BgNode } from '@/contracts/build-graph';
import type { BuildCadEstimate, BuildCadEstimateOption, CadSpec } from '@/contracts/cad';
import { MAX_QUOTE_QUANTITY, QuoteConfig, type CreateQuoteRequest, type QuoteView } from '@/contracts/quotes';
import { canonicalJson } from '@/server/auth/tokens';
import { getDb } from '@/server/db';
import { materials, quotes as quotesTable, services, thicknessOptions } from '@/server/db/schema';
import { ApiError } from '@/server/http';
import { createQuote, getQuote } from '@/server/quote';
import type { CadPanelPart } from './pipeline';

/** Catalog thickness options match the spec within this tolerance (gauge tables round to 0.01 mm). */
export const THICKNESS_MATCH_MM = 0.05;
const MAX_CANDIDATES = 4;

type Candidate = { materialId: string; slug: string; name: string; thicknessOptionId: string; recommended: boolean; compatible: string[] };

/** The buyer's stated quantity, if any: a user-sourced quantity requirement or an answered quantity question. */
export function buyerQuantity(nodes: BgNode[]): number | null {
    for (const n of nodes) {
        if (n.type !== 'REQUIREMENT') continue;
        const stated = n.source === 'user' || n.data.requirementSource === 'user';
        if (!stated || n.data.category !== 'quantity') continue;
        const text = String(n.data.answer ?? n.data.text ?? n.label);
        const m = /(\d{1,5})/.exec(text.replace(/,(?=\d{3})/g, ''));
        if (m) {
            const q = Number(m[1]);
            if (q >= 1 && q <= 5000) return q;
        }
    }
    return null;
}

function specThickness(spec: CadSpec): number | null {
    return 'thickness_mm' in spec ? spec.thickness_mm : null;
}

async function candidates(nodes: BgNode[], thickness: number, needsBend: boolean): Promise<Candidate[]> {
    const db = getDb();
    const order: { slug: string; recommended: boolean }[] = [];
    const roleRank = (n: BgNode) => (n.data.role === 'recommended' ? 0 : n.data.role === 'alternative' ? 1 : 2);
    for (const n of nodes.filter((x) => x.type === 'MATERIAL' && typeof x.data.catalogSlug === 'string').sort((a, b) => roleRank(a) - roleRank(b))) {
        const slug = n.data.catalogSlug as string;
        if (!order.some((o) => o.slug === slug)) order.push({ slug, recommended: n.data.role === 'recommended' });
    }
    const rows = await db
        .select({ materialId: materials.id, slug: materials.slug, name: materials.name, category: materials.category, optionId: thicknessOptions.id, thicknessMm: thicknessOptions.thicknessMm, bendable: thicknessOptions.bendable })
        .from(thicknessOptions)
        .innerJoin(materials, eq(materials.id, thicknessOptions.materialId))
        .where(and(eq(thicknessOptions.active, true), eq(materials.active, true)))
        .orderBy(asc(materials.sortOrder), asc(thicknessOptions.thicknessMm));
    const fits = rows.filter((r) => Math.abs(r.thicknessMm - thickness) <= THICKNESS_MATCH_MM && (!needsBend || r.bendable));
    const pick = (slug: string) => fits.filter((r) => r.slug === slug).sort((a, b) => Math.abs(a.thicknessMm - thickness) - Math.abs(b.thicknessMm - thickness))[0];
    const out: Candidate[] = [];
    for (const o of order) {
        const r = pick(o.slug);
        if (r) out.push({ materialId: r.materialId, slug: r.slug, name: r.name, thicknessOptionId: r.optionId, recommended: o.recommended, compatible: [] });
    }
    // No catalog material on the graph fits this sheet: fall back to every metal that stocks it.
    if (out.length === 0) {
        for (const r of fits) {
            if (r.category !== 'METAL' || out.some((c) => c.slug === r.slug)) continue;
            out.push({ materialId: r.materialId, slug: r.slug, name: r.name, thicknessOptionId: r.optionId, recommended: false, compatible: [] });
        }
    }
    return out.slice(0, MAX_CANDIDATES);
}

/**
 * Quote every panel for every candidate material. Returns null when there is no flat pattern,
 * a panel is not READY, or no catalog material stocks the sheet thickness.
 */
export async function estimateCadParts(input: { spec: CadSpec; parts: CadPanelPart[]; nodes: BgNode[] }): Promise<BuildCadEstimate | null> {
    const { spec, parts, nodes } = input;
    const thickness = specThickness(spec);
    if (!parts.length || thickness === null || parts.some((p) => p.part.status !== 'READY')) return null;
    const needsBend = parts.some((p) => (p.part.features?.bendCount ?? 0) > 0);
    const options = await candidates(nodes, thickness, needsBend);
    if (!options.length) return null;

    const serviceRows = await getDb()
        .select({ id: services.id, slug: services.slug, compatible: services.compatibleMaterialSlugs })
        .from(services)
        .where(and(eq(services.active, true), inArray(services.slug, ['bending', 'countersinking'])));
    const bending = serviceRows.find((s) => s.slug === 'bending');
    const countersinking = serviceRows.find((s) => s.slug === 'countersinking');
    const countersinks = spec.family === 'slotted_plate' ? spec.countersinks.length : 0;

    const stated = buyerQuantity(nodes);
    const notes: string[] = [];
    // Each panel is quoted at builds × pieces per build; the instant-quote engine stops at
    // MAX_QUOTE_QUANTITY pieces, so larger runs are priced at the largest whole number of builds.
    const maxBuilds = Math.max(1, Math.floor(MAX_QUOTE_QUANTITY / Math.max(...parts.map((p) => p.quantity))));
    const quantity = Math.min(stated ?? 1, maxBuilds);
    if (stated === null) notes.push('Priced for one build: tell us the quantity for a volume price.');
    if (stated !== null && stated > quantity) notes.push(`Priced for ${quantity} builds, the instant-quote limit. Larger runs get a production quote.`);
    notes.push('Purchased hardware in the BOM (rivets, screws, gaskets, glands) is not included.');

    const results: BuildCadEstimateOption[] = [];
    for (const c of options) {
        try {
            const quotes: QuoteView[] = [];
            for (const p of parts) {
                const selected: { serviceId: string; featureCount?: number }[] = [];
                if ((p.part.features?.bendCount ?? 0) > 0) {
                    if (!bending || !bending.compatible.includes(c.slug)) throw new ApiError('VALIDATION_FAILED', `${c.name} cannot be bent`);
                    selected.push({ serviceId: bending.id });
                }
                if (countersinks > 0) {
                    if (!countersinking || !countersinking.compatible.includes(c.slug)) throw new ApiError('VALIDATION_FAILED', `${c.name} cannot be countersunk`);
                    selected.push({ serviceId: countersinking.id, featureCount: countersinks });
                }
                quotes.push(await reuseOrCreateQuote({ partId: p.part.id, materialId: c.materialId, thicknessOptionId: c.thicknessOptionId, services: selected, quantity: quantity * p.quantity }));
            }
            const total = quotes.reduce((s, q) => s + q.subtotalCents, 0);
            results.push({
                materialSlug: c.slug,
                materialName: c.name,
                thicknessOptionId: c.thicknessOptionId,
                totalCents: total,
                unitCents: Math.round(total / quantity),
                makeabilityScore: Math.min(...quotes.map((q) => q.dfm.makeabilityScore)),
                leadTimeDays: Math.max(...quotes.map((q) => q.leadTimeDays)),
                shipDate: quotes.map((q) => q.shipDate).sort().at(-1)!,
                allBinding: quotes.every((q) => q.trustLevel === 'BINDING' && !q.dfm.blocking),
                quoteIds: quotes.map((q) => q.id),
                recommended: c.recommended,
            });
        } catch (err) {
            if (!(err instanceof ApiError)) throw err;
            notes.push(`${c.name}: ${err.message}`);
        }
    }
    if (!results.length) return null;
    const totals = results.map((r) => r.totalCents);
    const lead = results.map((r) => r.leadTimeDays);
    const primary = results.find((r) => r.recommended) ?? results.reduce((a, b) => (b.totalCents < a.totalCents ? b : a));
    return {
        quantity,
        quantitySource: stated === null ? 'default' : 'buyer',
        currency: 'usd',
        makeabilityScore: primary.makeabilityScore,
        priceRange: { lowCents: Math.min(...totals), highCents: Math.max(...totals) },
        productionDays: { min: Math.min(...lead), max: Math.max(...lead) },
        trustLevel: results.every((r) => r.allBinding) ? 'BINDING' : 'ESTIMATE',
        options: results,
        notes,
    };
}

/** Catalog sheet thicknesses per material, for the CAD agent's prompt. */
export async function catalogThicknessHints(): Promise<string[]> {
    const rows = await getDb()
        .select({ name: materials.name, thicknessMm: thicknessOptions.thicknessMm, bendable: thicknessOptions.bendable, minBend: thicknessOptions.minBendRadiusMm })
        .from(thicknessOptions)
        .innerJoin(materials, eq(materials.id, thicknessOptions.materialId))
        .where(and(eq(thicknessOptions.active, true), eq(materials.active, true)))
        .orderBy(asc(materials.sortOrder), asc(thicknessOptions.thicknessMm));
    const byMaterial = new Map<string, string[]>();
    for (const r of rows) {
        const list = byMaterial.get(r.name) ?? [];
        list.push(`${Math.round(r.thicknessMm * 100) / 100}${r.bendable ? (r.minBend ? ` (bend r>=${r.minBend})` : '') : ' (flat only)'}`);
        byMaterial.set(r.name, list);
    }
    return [...byMaterial].map(([name, list]) => `${name}: ${list.join(', ')} mm`);
}

/**
 * A READY, unexpired quote with exactly this configuration is reused, so a retried CAD
 * generation (e.g. after a 409 on the version write) does not persist a second set.
 */
async function reuseOrCreateQuote(input: CreateQuoteRequest): Promise<QuoteView> {
    const want = canonicalJson(QuoteConfig.parse(input));
    const rows = await getDb()
        .select({ id: quotesTable.id, config: quotesTable.config })
        .from(quotesTable)
        .where(and(eq(quotesTable.partId, input.partId), eq(quotesTable.status, 'READY'), gt(quotesTable.validUntil, new Date())))
        .orderBy(desc(quotesTable.createdAt))
        .limit(20);
    const match = rows.find((r) => canonicalJson(QuoteConfig.parse(r.config)) === want);
    if (match) {
        const view = await getQuote(match.id);
        if (view) return view;
    }
    return createQuote(input);
}
