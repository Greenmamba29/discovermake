/**
 * Version 1 of a Make AI build: CreationIntent (+ optional Materials Engineer advice) ->
 * Build Graph nodes and edges. Pure and deterministic.
 *
 *   build:root   BUILD        the build itself (summary, risk class, constraints)
 *   req:R1..     REQUIREMENT  source make_ai, confidence from the intent
 *   unk:U1..     UNKNOWN      NEEDS_INPUT questions: question, why, suggested_default, status "open"
 *   part:main    PART         first-cut decomposition, only when the intent names something to make
 *   mat:<slug>   MATERIAL     catalog materials (recommended / alternative / candidate)
 *   mat:src-*    MATERIAL     outside the catalog: labelled "needs sourcing"
 *   proc:*, finish:*          PROCESS / FINISH candidates matched against the catalog
 *
 * Edges: build CONSTRAINED_BY requirement, build BLOCKED_BY open unknown, build CONTAINS part,
 * part (or build) MADE_OF material, REQUIRES_PROCESS process, FINISHED_WITH finish.
 *
 * Never invents dimensions: the part only carries dimensions the buyer stated (user-sourced
 * dimension requirements, which `normalizeIntent` guarantees) and, later, answers.
 */
import type { BgEdgeInput, BgNodeInput } from '../../contracts/build-graph';
import type { CreationIntent, RequirementCategory } from '../../contracts/make-ai';
import type { BuildCatalog, CatalogMaterial } from './catalog';
import { clip, ROOT_NODE_KEY, slugify } from './graph';

export const MAIN_PART_KEY = 'part:main';

/** One material choice from the Materials Engineer, already checked against the catalog. */
export type MaterialPick = {
    /** Catalog slug, or null when the material is outside the catalog (needs sourcing). */
    catalogSlug: string | null;
    name: string;
    why: string;
    tradeoff?: string;
};

/** Normalized Materials Engineer answer (spec §15), see src/server/make-ai/materials.ts. */
export type MaterialAdvice = {
    recommended: MaterialPick;
    alternatives: MaterialPick[];
    tradeoffs: string[];
    risks: string[];
    processCompatibility: string;
    costEffect: 'lower' | 'similar' | 'higher' | 'unknown';
    costNote: string;
    leadTimeEffect: 'faster' | 'similar' | 'slower' | 'unknown';
    leadTimeNote: string;
    confidence: number;
    model: string;
};

export type GraphFromIntentInput = {
    intent: CreationIntent;
    intentId: string;
    model: string;
    name: string;
    displayId: string;
    catalog: BuildCatalog;
    advice?: MaterialAdvice | null;
};

export type IntentGraph = {
    nodes: BgNodeInput[];
    edges: BgEdgeInput[];
    requirementCount: number;
    unknownCount: number;
    /** The Materials Engineer's pick as written to the graph, for `material.recommended`. */
    recommended: { key: string; label: string; confidence: number } | null;
};

export type UnknownTopic = 'dimension' | 'quantity' | 'other';

const QUANTITY_WORDS = /\b(how many|quantity|qty|pieces|pcs|units|copies)\b/i;
const DIMENSION_WORDS =
    /\b(dimensions?|size|sized|width|wide|height|tall|length|long|depth|deep|thick|thickness|diameter|radius|gauge|mm|cm|inch|inches|footprint|clearance|fit|measure|measurements?)\b/i;

/** What a NEEDS_INPUT question is about (decides how its answer is filed). */
export function unknownTopic(question: string): UnknownTopic {
    if (QUANTITY_WORDS.test(question)) return 'quantity';
    if (DIMENSION_WORDS.test(question)) return 'dimension';
    return 'other';
}

export function topicCategory(topic: UnknownTopic): RequirementCategory {
    return topic === 'dimension' ? 'dimension' : topic === 'quantity' ? 'quantity' : 'other';
}

// ---------------------------------------------------------------------------
// Catalog matching (deterministic token overlap; ties broken by catalog order)
// ---------------------------------------------------------------------------

const GENERIC_TOKENS = new Set(['cutting', 'cut', 'sheet', 'metal', 'plate', 'steel', 'process', 'finish', 'finishing', 'and', 'the', 'of', 'for', 'with', 'or', 'type']);

function tokens(text: string): Set<string> {
    return new Set(
        text
            .normalize('NFKD')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((t) => t.length >= 2 || /\d/.test(t)),
    );
}

function score(text: Set<string>, item: { slug: string; name: string }): number {
    const own = new Set([...tokens(item.name), ...tokens(item.slug.replace(/-/g, ' '))]);
    let s = 0;
    for (const t of own) {
        if (!text.has(t)) continue;
        s += /\d/.test(t) ? 2 : GENERIC_TOKENS.has(t) ? 0.25 : 1;
    }
    return s;
}

/** Best-scoring catalog items for `text` (all ties, in catalog order); empty when nothing meaningful matches. */
export function matchCatalog<T extends { slug: string; name: string }>(text: string, items: readonly T[]): T[] {
    const t = tokens(text);
    let best = 0;
    let out: T[] = [];
    for (const item of items) {
        const s = score(t, item);
        if (s < 1) continue;
        if (s > best + 1e-9) {
            best = s;
            out = [item];
        } else if (Math.abs(s - best) < 1e-9) out.push(item);
    }
    return out;
}

export function matchMaterial(text: string, materials: readonly CatalogMaterial[]): CatalogMaterial | null {
    return matchCatalog(text, materials)[0] ?? null;
}

type ProcessCandidate = { kind: 'process' | 'secondary' | 'finish'; slug: string; name: string; materialSlugs: string[] };

type ProcessNodeSpec = { key: string; type: 'PROCESS' | 'FINISH'; label: string; data: Record<string, unknown> };

/** Map one suggested process name to a PROCESS / FINISH node spec (catalog row, finish family, or needs sourcing). */
export function matchProcess(text: string, catalog: BuildCatalog, materialSlugs: readonly string[]): ProcessNodeSpec {
    const candidates: ProcessCandidate[] = [
        ...catalog.processes.map((p) => ({ kind: 'process' as const, slug: p.slug, name: p.name, materialSlugs: p.materialSlugs })),
        ...catalog.services.map((s) => ({ kind: s.kind === 'FINISH' ? ('finish' as const) : ('secondary' as const), slug: s.slug, name: s.name, materialSlugs: s.compatibleMaterialSlugs })),
    ];
    const ties = matchCatalog(text, candidates);
    const fits = (c: ProcessCandidate) => materialSlugs.some((m) => c.materialSlugs.includes(m));
    const primary = ties.filter((c) => c.kind === 'process');
    if (primary.length > 0) {
        const pick = primary.find(fits) ?? primary[0]!;
        return { key: `proc:${pick.slug}`, type: 'PROCESS', label: pick.name, data: { catalogSlug: pick.slug, inCatalog: true, needsSourcing: false, kind: 'primary', suggested: text } };
    }
    const secondary = ties.filter((c) => c.kind === 'secondary');
    if (secondary.length > 0) {
        const pick = secondary[0]!;
        return { key: `proc:${pick.slug}`, type: 'PROCESS', label: pick.name, data: { catalogSlug: pick.slug, inCatalog: true, needsSourcing: false, kind: 'secondary', suggested: text } };
    }
    const finishes = ties.filter((c) => c.kind === 'finish');
    if (finishes.length === 1) {
        const pick = finishes[0]!;
        return { key: `finish:${pick.slug}`, type: 'FINISH', label: pick.name, data: { catalogSlug: pick.slug, inCatalog: true, needsSourcing: false, options: [pick.slug], suggested: text } };
    }
    if (finishes.length > 1) {
        // A finish family (e.g. powder coat in five colours): never pick a colour for the buyer.
        const family = finishes[0]!.name.split('·')[0]!.trim() || text;
        return {
            key: `finish:${slugify(family)}`,
            type: 'FINISH',
            label: clip(family, 200),
            data: { catalogSlug: null, inCatalog: true, needsSourcing: false, options: finishes.map((f) => f.slug), choice: null, suggested: text },
        };
    }
    return {
        key: `proc:src-${slugify(text)}`,
        type: 'PROCESS',
        label: clip(`${text} (needs sourcing)`, 200),
        data: { catalogSlug: null, inCatalog: false, needsSourcing: true, kind: 'unknown', suggested: text },
    };
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function safeKeyName(raw: string, fallback: string): string {
    const s = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
    return s || fallback;
}

/** Key + label of a material node: catalog slug when known, else a "needs sourcing" key. */
export function materialNodeIdentity(pick: { catalogSlug: string | null; name: string }, catalog: BuildCatalog): { key: string; label: string; inCatalog: boolean } {
    const row = pick.catalogSlug ? catalog.materials.find((m) => m.slug === pick.catalogSlug) : undefined;
    if (row) return { key: `mat:${row.slug}`, label: clip(row.name, 200), inCatalog: true };
    return { key: `mat:src-${slugify(pick.name)}`, label: clip(`${pick.name} (needs sourcing)`, 200), inCatalog: false };
}

export function graphFromIntent(input: GraphFromIntentInput): IntentGraph {
    const { intent, intentId, catalog, advice } = input;
    const intentProvenance = `make_intent:${intentId}`;
    const nodes: BgNodeInput[] = [];
    const edges: BgEdgeInput[] = [];
    const keys = new Set<string>();
    const addNode = (n: BgNodeInput) => {
        keys.add(n.key);
        nodes.push(n);
    };
    const addEdge = (e: Omit<BgEdgeInput, 'data'> & { data?: Record<string, unknown> }) => {
        if (edges.some((x) => x.type === e.type && x.fromKey === e.fromKey && x.toKey === e.toKey)) return;
        edges.push({ ...e, data: e.data ?? {} });
    };

    addNode({
        key: ROOT_NODE_KEY,
        type: 'BUILD',
        label: clip(input.name, 200),
        data: {
            displayId: input.displayId,
            intentId,
            intent: intent.intent,
            productType: intent.product_type,
            summary: intent.summary,
            riskClass: intent.risk_class,
            constraints: intent.constraints,
            requiredSpecialists: intent.required_specialists,
            estimateOnly: true,
        },
        confidence: null,
        source: 'make_ai',
        provenance: clip(`${intentProvenance} · ${input.model}`, 200),
    });

    const dimensionReqs: { key: string; text: string }[] = [];
    intent.requirements.forEach((r, i) => {
        let key = `req:${safeKeyName(r.id, `R${i + 1}`)}`;
        if (keys.has(key)) key = `req:R${i + 1}_${i}`;
        addNode({
            key,
            type: 'REQUIREMENT',
            label: clip(r.text, 200),
            data: { text: r.text, category: r.category, requirementSource: r.source },
            confidence: r.confidence,
            source: 'make_ai',
            provenance: intentProvenance,
        });
        addEdge({ type: 'CONSTRAINED_BY', fromKey: ROOT_NODE_KEY, toKey: key });
        if (r.category === 'dimension' && r.source === 'user') dimensionReqs.push({ key, text: r.text });
    });

    intent.unknowns.forEach((u, i) => {
        const key = `unk:U${i + 1}`;
        addNode({
            key,
            type: 'UNKNOWN',
            label: clip(u.question, 200),
            data: { question: u.question, why: u.why_it_matters, suggested_default: u.suggested_default ?? null, status: 'open', topic: unknownTopic(u.question) },
            confidence: null,
            source: 'make_ai',
            provenance: intentProvenance,
        });
        addEdge({ type: 'BLOCKED_BY', fromKey: ROOT_NODE_KEY, toKey: key });
    });

    const makeable = intent.materials_suggested.length > 0 || intent.processes_suggested.length > 0 || Boolean(advice);
    const holder = makeable ? MAIN_PART_KEY : ROOT_NODE_KEY;
    if (makeable) {
        addNode({
            key: MAIN_PART_KEY,
            type: 'PART',
            label: clip(`${capitalize(intent.product_type)} · main part`, 200),
            data: {
                role: 'main',
                decomposition: 'first_cut',
                dimensions: dimensionReqs.map((d) => ({ text: d.text, from: d.key })),
                dimensionsStatus: dimensionReqs.length > 0 ? 'stated' : 'needs_input',
            },
            confidence: null,
            source: 'system',
            provenance: intentProvenance,
        });
        addEdge({ type: 'CONTAINS', fromKey: ROOT_NODE_KEY, toKey: MAIN_PART_KEY });
        for (const d of dimensionReqs) addEdge({ type: 'CONSTRAINED_BY', fromKey: MAIN_PART_KEY, toKey: d.key });
    }

    // Materials: the engineer's picks first, then the intake's suggestions as candidates.
    let recommended: IntentGraph['recommended'] = null;
    const materialSlugs: string[] = [];
    const addMaterial = (pick: MaterialPick, role: 'recommended' | 'alternative' | 'candidate', extra: Record<string, unknown>, confidence: number | null, provenance: string) => {
        const id = materialNodeIdentity(pick, catalog);
        if (keys.has(id.key)) {
            const existing = nodes.find((n) => n.key === id.key)!;
            existing.data = { ...existing.data, alsoSuggestedBy: [...((existing.data.alsoSuggestedBy as string[] | undefined) ?? []), role] };
            return;
        }
        if (id.inCatalog && pick.catalogSlug) materialSlugs.push(pick.catalogSlug);
        addNode({
            key: id.key,
            type: 'MATERIAL',
            label: id.label,
            data: { role, name: pick.name, catalogSlug: id.inCatalog ? pick.catalogSlug : null, inCatalog: id.inCatalog, needsSourcing: !id.inCatalog, why: pick.why, ...(pick.tradeoff ? { tradeoff: pick.tradeoff } : {}), ...extra },
            confidence,
            source: 'make_ai',
            provenance: clip(provenance, 200),
        });
        addEdge({ type: 'MADE_OF', fromKey: holder, toKey: id.key, data: { role } });
        if (role === 'recommended') recommended = { key: id.key, label: id.label, confidence: confidence ?? 0 };
    };
    if (advice) {
        const engineer = `materials_engineer:${advice.model}`;
        addMaterial(
            advice.recommended,
            'recommended',
            {
                suggestedBy: 'materials_engineer',
                tradeoffs: advice.tradeoffs,
                risks: advice.risks,
                processCompatibility: advice.processCompatibility,
                costEffect: advice.costEffect,
                costNote: advice.costNote,
                leadTimeEffect: advice.leadTimeEffect,
                leadTimeNote: advice.leadTimeNote,
            },
            advice.confidence,
            engineer,
        );
        for (const alt of advice.alternatives) addMaterial(alt, 'alternative', { suggestedBy: 'materials_engineer' }, null, engineer);
    }
    for (const m of intent.materials_suggested) {
        const row = matchMaterial(m.material, catalog.materials);
        addMaterial({ catalogSlug: row?.slug ?? null, name: row?.name ?? m.material, why: m.why }, 'candidate', { suggestedBy: 'make_ai_intake', suggested: m.material }, null, intentProvenance);
    }

    for (const p of intent.processes_suggested) {
        const spec = matchProcess(p, catalog, materialSlugs);
        if (!keys.has(spec.key)) {
            addNode({ key: spec.key, type: spec.type, label: spec.label, data: spec.data, confidence: null, source: 'make_ai', provenance: intentProvenance });
        }
        addEdge({ type: spec.type === 'FINISH' ? 'FINISHED_WITH' : 'REQUIRES_PROCESS', fromKey: holder, toKey: spec.key });
    }

    return { nodes, edges, requirementCount: intent.requirements.length, unknownCount: intent.unknowns.length, recommended };
}
