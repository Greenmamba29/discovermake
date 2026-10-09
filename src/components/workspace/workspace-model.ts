/**
 * Pure view-model helpers for the Build Workspace (EPIC-300): which sections have real
 * data, open questions, the Make AI confidence summary and typed reads of node `data`.
 * No React, no fetching. Node `data` is free-form (BgData), so every read is guarded.
 */
import type { BgEdge, BgNode, BuildGraphView, DesignVersionStatus } from '@/contracts';

export const WORKSPACE_SECTIONS = ['overview', 'object', 'requirements', 'questions', 'materials', 'parts', 'attachments', 'assistant', 'graph', 'versions'] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const SECTION_LABEL: Record<WorkspaceSection, string> = {
    overview: 'Overview',
    object: 'Object',
    requirements: 'Requirements',
    questions: 'Questions',
    materials: 'Materials',
    parts: 'Parts',
    attachments: 'Files',
    assistant: 'Ask Make AI',
    graph: 'Graph',
    versions: 'Versions',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export function isWorkspaceSection(v: unknown): v is WorkspaceSection {
    return typeof v === 'string' && (WORKSPACE_SECTIONS as readonly string[]).includes(v);
}

export const nodesOf = (view: BuildGraphView, ...types: BgNode['type'][]) => view.nodes.filter((n) => types.includes(n.type));

/**
 * Sections backed by real nodes in this version. Overview, Object (the 3D model, or an honest
 * "generate CAD" state), Files, Ask Make AI, Graph and Versions always exist for a graph build.
 */
export function availableSections(view: BuildGraphView): WorkspaceSection[] {
    const has = (...types: BgNode['type'][]) => view.nodes.some((n) => types.includes(n.type));
    return WORKSPACE_SECTIONS.filter((s) => {
        switch (s) {
            case 'requirements':
                return has('REQUIREMENT');
            case 'questions':
                return has('UNKNOWN');
            case 'materials':
                return has('MATERIAL');
            case 'parts':
                return has('PART', 'ASSEMBLY', 'PROCESS', 'FINISH');
            default:
                return true;
        }
    });
}

export type UnknownInfo = { key: string; question: string; why: string | null; suggestedDefault: string | null; open: boolean; answer: string | null; usedDefault: boolean };

export function unknownInfo(n: BgNode): UnknownInfo {
    const d = n.data ?? {};
    return {
        key: n.key,
        question: str(d.question) ?? n.label,
        why: str(d.why),
        suggestedDefault: str(d.suggested_default),
        open: d.status === 'open',
        answer: str(d.answer),
        usedDefault: d.usedDefault === true,
    };
}

export const openUnknowns = (view: BuildGraphView) => nodesOf(view, 'UNKNOWN').map(unknownInfo).filter((u) => u.open);
export const answeredUnknowns = (view: BuildGraphView) => nodesOf(view, 'UNKNOWN').map(unknownInfo).filter((u) => !u.open);

export type RequirementInfo = { key: string; text: string; category: string | null; statedByBuyer: boolean; fromAnswer: boolean; confidence: number | null };

export function requirementInfo(n: BgNode): RequirementInfo {
    const d = n.data ?? {};
    const fromAnswer = typeof d.answers === 'string';
    return {
        key: n.key,
        text: fromAnswer ? `${str(d.question) ?? 'Your answer'} ${n.label}` : (str(d.text) ?? n.label),
        category: str(d.category),
        statedByBuyer: n.source === 'user' || d.requirementSource === 'user',
        fromAnswer,
        confidence: n.confidence,
    };
}

export type MaterialRole = 'recommended' | 'alternative' | 'candidate';

export type MaterialInfo = {
    key: string;
    label: string;
    role: MaterialRole;
    inCatalog: boolean;
    why: string | null;
    tradeoff: string | null;
    tradeoffs: string[];
    risks: string[];
    processCompatibility: string | null;
    costEffect: string | null;
    costNote: string | null;
    leadTimeEffect: string | null;
    leadTimeNote: string | null;
    confidence: number | null;
    byEngineer: boolean;
};

const ROLE_ORDER: Record<MaterialRole, number> = { recommended: 0, alternative: 1, candidate: 2 };

export function materialInfo(n: BgNode): MaterialInfo {
    const d = n.data ?? {};
    const role: MaterialRole = d.role === 'recommended' || d.role === 'alternative' ? d.role : 'candidate';
    return {
        key: n.key,
        label: n.label,
        role,
        inCatalog: d.inCatalog === true && d.needsSourcing !== true,
        why: str(d.why),
        tradeoff: str(d.tradeoff),
        tradeoffs: strings(d.tradeoffs),
        risks: strings(d.risks),
        processCompatibility: str(d.processCompatibility),
        costEffect: str(d.costEffect),
        costNote: str(d.costNote),
        leadTimeEffect: str(d.leadTimeEffect),
        leadTimeNote: str(d.leadTimeNote),
        confidence: n.confidence,
        byEngineer: d.suggestedBy === 'materials_engineer',
    };
}

export const materialsOf = (view: BuildGraphView) => nodesOf(view, 'MATERIAL').map(materialInfo).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.label.localeCompare(b.label));

export type PartInfo = { key: string; label: string; type: 'PART' | 'ASSEMBLY'; dimensions: string[]; dimensionsStated: boolean; materials: string[]; processes: string[]; finishes: string[] };

export function partsOf(view: BuildGraphView): PartInfo[] {
    const label = new Map(view.nodes.map((n) => [n.key, n.label]));
    const targets = (from: string, type: BgEdge['type']) => view.edges.filter((e) => e.fromKey === from && e.type === type).map((e) => label.get(e.toKey) ?? e.toKey);
    return nodesOf(view, 'ASSEMBLY', 'PART').map((n) => {
        const dims = Array.isArray(n.data?.dimensions) ? (n.data.dimensions as unknown[]) : [];
        const dimensions = dims.map((d) => (typeof d === 'string' ? d : str((d as { text?: unknown })?.text))).filter((d): d is string => Boolean(d));
        return {
            key: n.key,
            label: n.label,
            type: n.type === 'ASSEMBLY' ? 'ASSEMBLY' : 'PART',
            dimensions,
            dimensionsStated: dimensions.length > 0,
            materials: targets(n.key, 'MADE_OF'),
            processes: targets(n.key, 'REQUIRES_PROCESS'),
            finishes: targets(n.key, 'FINISHED_WITH'),
        };
    });
}

export type ProcessInfo = { key: string; label: string; type: 'PROCESS' | 'FINISH'; inCatalog: boolean; options: number };

export const processesOf = (view: BuildGraphView): ProcessInfo[] =>
    nodesOf(view, 'PROCESS', 'FINISH').map((n) => ({
        key: n.key,
        label: n.label,
        type: n.type === 'FINISH' ? 'FINISH' : 'PROCESS',
        inCatalog: n.data?.inCatalog === true && n.data?.needsSourcing !== true,
        options: strings(n.data?.options).length,
    }));

export type ConfidenceSummary = { count: number; average: number | null; lowest: { label: string; confidence: number } | null };

/** Average + lowest confidence across Make AI nodes that carry one. */
export function confidenceSummary(view: BuildGraphView): ConfidenceSummary {
    const scored = view.nodes.filter((n) => n.source === 'make_ai' && typeof n.confidence === 'number') as (BgNode & { confidence: number })[];
    if (scored.length === 0) return { count: 0, average: null, lowest: null };
    const average = scored.reduce((s, n) => s + n.confidence, 0) / scored.length;
    const low = scored.reduce((a, b) => (b.confidence < a.confidence ? b : a));
    return { count: scored.length, average, lowest: { label: low.label, confidence: low.confidence } };
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function rootNode(view: BuildGraphView): BgNode | undefined {
    return view.nodes.find((n) => n.key === 'build:root') ?? view.nodes.find((n) => n.type === 'BUILD' && n.data?.role !== 'source');
}

export type BuildBrief = { summary: string | null; productType: string | null; riskClass: string | null; constraints: string[]; specialists: string[]; derivedFrom: { displayId: string; version: number | null } | null };

export function buildBrief(view: BuildGraphView): BuildBrief {
    const d = rootNode(view)?.data ?? {};
    const derived = d.derivedFrom as { displayId?: unknown; version?: unknown } | undefined;
    return {
        summary: str(d.summary),
        productType: str(d.productType),
        riskClass: str(d.riskClass),
        constraints: strings(d.constraints),
        specialists: strings(d.requiredSpecialists),
        derivedFrom: derived && typeof derived.displayId === 'string' ? { displayId: derived.displayId, version: typeof derived.version === 'number' ? derived.version : null } : null,
    };
}

/** The approved version number, if any version is APPROVED. */
export function approvedVersion(view: BuildGraphView): number | null {
    return view.versions.find((v) => v.status === 'APPROVED')?.version ?? null;
}

export const latestVersion = (view: BuildGraphView) => Math.max(...view.versions.map((v) => v.version));

/** A DRAFT version newer than the approved one can be approved. */
export function canApprove(view: BuildGraphView, version: number): boolean {
    const v = view.versions.find((x) => x.version === version);
    if (!v || v.status !== 'DRAFT') return false;
    const approved = approvedVersion(view);
    return approved === null || version > approved;
}

export const VERSION_STATUS_LABEL: Record<DesignVersionStatus, string> = { DRAFT: 'Draft', APPROVED: 'Approved', SUPERSEDED: 'Superseded' };

/** The one next step the buyer should take, in plain language. */
export function nextAction(view: BuildGraphView): { title: string; detail: string; section: WorkspaceSection } {
    const open = openUnknowns(view).length;
    if (open > 0) return { title: `Answer ${open} question${open === 1 ? '' : 's'}`, detail: 'Make AI needs these before anything can be cut. We never guess sizes.', section: 'questions' };
    if (approvedVersion(view) !== latestVersion(view)) return { title: `Approve version ${latestVersion(view)}`, detail: 'Approving locks this version so it can be remixed, sourced and quoted exactly.', section: 'versions' };
    return { title: 'Get a binding price', detail: 'This version is approved. Generate CAD below, or upload your own flat-pattern DXF, to get an instant binding quote.', section: 'overview' };
}
