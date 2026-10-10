/**
 * Build Graph mapping for the buyer order page (spec §8.4 Graph View, ADR-0001).
 *
 * Pure: maps the buyer `OrderView` contract to Build Graph nodes + edges and a
 * deterministic left-to-right layout. No React, no fetching, no clock. Nodes the
 * view has no data for are omitted; nothing here is invented client-side.
 *
 *   Build -CONTAINS-> Part -MADE_OF-> MaterialSpec -REQUIRES_PROCESS-> ProcessPlan(s)
 *     -MANUFACTURED_BY-> Facility -INSPECTED_BY-> InspectionResult
 *     -DELIVERED_BY-> Shipment -RECORDED_IN-> ProductPassport
 *
 * Node + edge names follow spec §6.1 / §6.2. `RECORDED_IN` is the one display-only
 * edge (§6.2 has no Shipment -> Passport relationship); it is not persisted.
 *
 * R2: `buildGraphFromView` maps a persisted Build Graph version (`BuildGraphView`) onto the
 * same display model so the workspace Graph View reuses the order page's canvas.
 */
import type { BgNode, BgNodeType, BuildGraphView, BuildTrustState, OrderView, TrackingStepKey, UniversalStatus } from '@/contracts';
import { shortDate } from './format';

/** Spec §6.1 node types shown on the order page. */
export const ORDER_GRAPH_NODE_TYPES = [
    'Build',
    'Part',
    'MaterialSpec',
    'ProcessPlan',
    'Facility',
    'InspectionResult',
    'Shipment',
    'ProductPassport',
] as const;
type OrderGraphNodeType = (typeof ORDER_GRAPH_NODE_TYPES)[number];

/** Every display node type: the order page's plus the R2 Build Graph ones (workspace Graph View). */
export const BUILD_GRAPH_NODE_TYPES = [...ORDER_GRAPH_NODE_TYPES, 'Requirement', 'Unknown', 'Assembly', 'Finish', 'Supplier', 'Quote', 'Order'] as const;
export type BuildGraphNodeType = (typeof BUILD_GRAPH_NODE_TYPES)[number];

/** Spec §6.2 relationships (+ display-only RECORDED_IN). The first seven are the order page's. */
export const BUILD_GRAPH_EDGE_TYPES = [
    'CONTAINS',
    'MADE_OF',
    'REQUIRES_PROCESS',
    'MANUFACTURED_BY',
    'INSPECTED_BY',
    'DELIVERED_BY',
    'RECORDED_IN',
    'FINISHED_WITH',
    'CONSTRAINED_BY',
    'BLOCKED_BY',
    'SOURCED_FROM',
    'QUOTED_AS',
    'ORDERED_AS',
    'SHIPPED_AS',
    'DERIVED_FROM',
] as const;
export type BuildGraphEdgeType = (typeof BUILD_GRAPH_EDGE_TYPES)[number];

/** Progress of one node. Rendered with the universal status language (`status`). */
export type BuildGraphNodeState = 'done' | 'active' | 'pending' | 'failed' | 'cancelled';
export type BuildGraphEdgeState = 'done' | 'active' | 'pending';

export interface BuildGraphNode {
    id: string;
    type: BuildGraphNodeType;
    /** Short kind label, e.g. "Material". */
    typeLabel: string;
    /** Main line, e.g. "Aluminum 6061". */
    label: string;
    /** Secondary technical line, e.g. `0.090" · Powder coat`; null when the view has nothing more. */
    value: string | null;
    state: BuildGraphNodeState;
    /** Universal status (spec §23) for the pill. */
    status: UniversalStatus;
    /** Layout column (0-based, left to right) and row within that column. */
    column: number;
    row: number;
}

export interface BuildGraphEdge {
    id: string;
    type: BuildGraphEdgeType;
    source: string;
    target: string;
    state: BuildGraphEdgeState;
}

export interface BuildGraph {
    nodes: BuildGraphNode[];
    edges: BuildGraphEdge[];
    columns: number;
    /** Tallest column (rows). */
    rows: number;
}

/** Edge type is decided by the target's node type (the chain is linear by column). */
const INBOUND_EDGE: Record<Exclude<OrderGraphNodeType, 'Build'>, BuildGraphEdgeType> = {
    Part: 'CONTAINS',
    MaterialSpec: 'MADE_OF',
    ProcessPlan: 'REQUIRES_PROCESS',
    Facility: 'MANUFACTURED_BY',
    InspectionResult: 'INSPECTED_BY',
    Shipment: 'DELIVERED_BY',
    ProductPassport: 'RECORDED_IN',
};

/** Plain-language relationship text (screen-reader list, tooltips). */
export const EDGE_PHRASE: Record<BuildGraphEdgeType, string> = {
    CONTAINS: 'contains',
    MADE_OF: 'made of',
    REQUIRES_PROCESS: 'requires process',
    MANUFACTURED_BY: 'manufactured by',
    INSPECTED_BY: 'inspected by',
    DELIVERED_BY: 'delivered by',
    RECORDED_IN: 'recorded in',
    FINISHED_WITH: 'finished with',
    CONSTRAINED_BY: 'constrained by',
    BLOCKED_BY: 'blocked by',
    SOURCED_FROM: 'sourced from',
    QUOTED_AS: 'quoted as',
    ORDERED_AS: 'ordered as',
    SHIPPED_AS: 'shipped as',
    DERIVED_FROM: 'derived from',
};

/** Order universal statuses that describe work in flight; used for the active node's pill. */
const IN_FLIGHT: ReadonlySet<UniversalStatus> = new Set(['NEEDS_INPUT', 'READY', 'REVIEW', 'IN_PRODUCTION']);

function universalFor(state: BuildGraphNodeState, order: OrderView): UniversalStatus {
    switch (state) {
        case 'done':
            return 'COMPLETE';
        case 'active':
            return IN_FLIGHT.has(order.universalStatus) ? order.universalStatus : 'IN_PRODUCTION';
        case 'pending':
            return 'DRAFT';
        case 'failed':
            return 'FAILED';
        case 'cancelled':
            return 'CANCELLED';
    }
}

function isCancelled(order: OrderView): boolean {
    return order.status === 'CANCELLED' || order.status === 'REFUNDED';
}

/**
 * Node state from the server-computed tracker steps the node spans.
 * A cancelled order turns every unfinished node CANCELLED; a QA failure only fails
 * the inspection node (the shop keeps working on the rework), so spanned steps read active.
 */
function stateFromSteps(order: OrderView, keys: readonly TrackingStepKey[]): BuildGraphNodeState {
    const states = order.steps.filter((s) => keys.includes(s.key)).map((s) => s.state);
    if (states.length > 0 && states.every((s) => s === 'done')) return 'done';
    if (isCancelled(order)) return 'cancelled';
    if (states.some((s) => s === 'current' || s === 'failed')) return order.status === 'PAYMENT_FAILED' ? 'pending' : 'active';
    if (states.some((s) => s === 'done')) return 'active';
    return 'pending';
}

function edgeState(source: BuildGraphNode, target: BuildGraphNode): BuildGraphEdgeState {
    if (source.state === 'done' && target.state === 'done') return 'done';
    if ((source.state === 'done' || source.state === 'active') && (target.state === 'active' || target.state === 'failed')) return 'active';
    return 'pending';
}

type Draft = Omit<BuildGraphNode, 'status' | 'column' | 'row'>;

function formatMm(mm: number): string {
    return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
}

/** OrderView -> Build Graph (nodes, edges, layout grid). */
export function buildGraphFromOrder(order: OrderView): BuildGraph {
    const s = order.summary;
    const columns: Draft[][] = [];

    // Build + Part: the order references a locked design version, so both are done.
    columns.push([{ id: 'build', type: 'Build', typeLabel: 'Build', label: order.build.name, value: `${order.build.displayId} · design v${order.designVersion}`, state: 'done' }]);
    const size = s.bboxWidthMm > 0 && s.bboxHeightMm > 0 ? ` · ${formatMm(s.bboxWidthMm)} × ${formatMm(s.bboxHeightMm)} mm` : '';
    columns.push([{ id: 'part', type: 'Part', typeLabel: 'Part', label: s.partFilename, value: `${s.quantity} pcs${size}`, state: 'done' }]);

    columns.push([
        {
            id: 'material',
            type: 'MaterialSpec',
            typeLabel: 'Material',
            label: s.materialName,
            value: [s.thicknessLabel, s.finishName].filter(Boolean).join(' · ') || null,
            state: stateFromSteps(order, ['MATERIALS']),
        },
    ]);

    const productionState = stateFromSteps(order, ['PRODUCTION']);
    columns.push([
        { id: 'process', type: 'ProcessPlan', typeLabel: 'Process', label: s.processName, value: 'Primary process', state: productionState },
        ...s.serviceNames.map(
            (name, i): Draft => ({ id: `service-${i}`, type: 'ProcessPlan', typeLabel: 'Service', label: name, value: 'Secondary service', state: productionState }),
        ),
    ]);

    if (order.shop) {
        columns.push([
            {
                id: 'shop',
                type: 'Facility',
                typeLabel: 'Shop',
                label: order.shop.name,
                value: `${order.shop.city}, ${order.shop.region}`,
                state: stateFromSteps(order, ['MATERIALS', 'PRODUCTION', 'QA']),
            },
        ]);
    }

    const qaMilestone = order.milestones.some((m) => m.kind === 'QA');
    if (order.inspection || qaMilestone) {
        let state: BuildGraphNodeState;
        let value: string;
        if (order.inspection?.outcome === 'PASS') {
            state = 'done';
            value = `Passed · ${shortDate(order.inspection.at)}`;
        } else if (isCancelled(order)) {
            state = 'cancelled';
            value = order.inspection ? 'Failed' : 'Inspection stopped';
        } else if (order.inspection?.outcome === 'FAIL') {
            state = 'failed';
            value = 'Failed · part being remade';
        } else {
            state = 'active';
            value = 'Inspection under way';
        }
        columns.push([{ id: 'qa', type: 'InspectionResult', typeLabel: 'QA', label: 'Inspection', value, state }]);
    }

    if (order.shipment) {
        const sh = order.shipment;
        let state: BuildGraphNodeState;
        if (sh.status === 'DELIVERED' || order.deliveredAt) state = 'done';
        else if (sh.status === 'CANCELLED') state = 'cancelled';
        else if (sh.status === 'EXCEPTION' || sh.status === 'RETURNED') state = 'failed';
        else state = isCancelled(order) ? 'cancelled' : 'active';
        const eta = state === 'active' && sh.estimatedDeliveryDate ? ` · arrives ${shortDate(sh.estimatedDeliveryDate)}` : '';
        columns.push([{ id: 'shipment', type: 'Shipment', typeLabel: 'Shipment', label: `${sh.carrier} ${sh.service}`.trim(), value: `${sh.trackingNumber}${eta}`, state }]);
    }

    if (order.passport) {
        columns.push([{ id: 'passport', type: 'ProductPassport', typeLabel: 'Passport', label: 'Product Passport', value: `Activated ${shortDate(order.passport.activatedAt)}`, state: 'done' }]);
    }

    const nodes: BuildGraphNode[] = columns.flatMap((col, column) => col.map((d, row) => ({ ...d, status: universalFor(d.state, order), column, row })));
    const byColumn = (c: number) => nodes.filter((n) => n.column === c);

    const edges: BuildGraphEdge[] = [];
    for (let c = 1; c < columns.length; c++) {
        for (const target of byColumn(c)) {
            if (target.type === 'Build') continue;
            const type = INBOUND_EDGE[target.type as Exclude<OrderGraphNodeType, 'Build'>];
            for (const source of byColumn(c - 1)) {
                edges.push({ id: `${source.id}->${target.id}`, type, source: source.id, target: target.id, state: edgeState(source, target) });
            }
        }
    }

    return { nodes, edges, columns: columns.length, rows: Math.max(...columns.map((c) => c.length)) };
}

/** Fixed node box + gaps for the deterministic layout (px, flow coordinates). */
export const GRAPH_LAYOUT = { nodeWidth: 212, nodeHeight: 104, gapX: 56, gapY: 20 } as const;

/**
 * Left-to-right layout: x by column, rows centred vertically on the tallest column.
 * Deterministic (no layout library), so the same order always renders the same picture.
 */
export function layoutBuildGraph(graph: BuildGraph): Map<string, { x: number; y: number }> {
    const { nodeWidth, nodeHeight, gapX, gapY } = GRAPH_LAYOUT;
    const rowsIn = new Map<number, number>();
    for (const n of graph.nodes) rowsIn.set(n.column, (rowsIn.get(n.column) ?? 0) + 1);
    const tallest = (graph.rows - 1) * (nodeHeight + gapY);
    const out = new Map<string, { x: number; y: number }>();
    for (const n of graph.nodes) {
        const count = rowsIn.get(n.column) ?? 1;
        const columnHeight = (count - 1) * (nodeHeight + gapY);
        out.set(n.id, { x: n.column * (nodeWidth + gapX), y: (tallest - columnHeight) / 2 + n.row * (nodeHeight + gapY) });
    }
    return out;
}

/** One plain sentence per node for the screen-reader list. */
export function describeNode(node: BuildGraphNode, graph: BuildGraph, statusLabel: string): string {
    const inbound = graph.edges.filter((e) => e.target === node.id);
    const from = inbound
        .map((e) => {
            const src = graph.nodes.find((n) => n.id === e.source);
            return src ? `${src.label} ${EDGE_PHRASE[e.type]} ${node.label}` : null;
        })
        .filter(Boolean);
    const parts = [`${node.typeLabel}: ${node.label}`];
    if (node.value) parts.push(node.value);
    parts.push(`Status: ${statusLabel}`);
    if (from.length) parts.push(`Linked from ${from.join('; ')}`);
    return parts.join('. ') + '.';
}

// ---------------------------------------------------------------------------
// R2: persisted Build Graph (BuildGraphView) -> display graph (workspace Graph View)
// ---------------------------------------------------------------------------

/** Persisted node type -> display node type + kind label. */
export const BG_NODE_DISPLAY: Record<BgNodeType, { type: BuildGraphNodeType; typeLabel: string }> = {
    BUILD: { type: 'Build', typeLabel: 'Build' },
    REQUIREMENT: { type: 'Requirement', typeLabel: 'Requirement' },
    UNKNOWN: { type: 'Unknown', typeLabel: 'Question' },
    ASSEMBLY: { type: 'Assembly', typeLabel: 'Assembly' },
    PART: { type: 'Part', typeLabel: 'Part' },
    MATERIAL: { type: 'MaterialSpec', typeLabel: 'Material' },
    PROCESS: { type: 'ProcessPlan', typeLabel: 'Process' },
    FINISH: { type: 'Finish', typeLabel: 'Finish' },
    SUPPLIER: { type: 'Supplier', typeLabel: 'Supplier' },
    SHOP: { type: 'Facility', typeLabel: 'Shop' },
    QUOTE: { type: 'Quote', typeLabel: 'Quote' },
    ORDER: { type: 'Order', typeLabel: 'Order' },
    QA: { type: 'InspectionResult', typeLabel: 'QA' },
    SHIPMENT: { type: 'Shipment', typeLabel: 'Shipment' },
    PASSPORT: { type: 'ProductPassport', typeLabel: 'Passport' },
};

/** Left-to-right column per persisted node type (empty columns are dropped). */
const BG_COLUMN: Record<BgNodeType, number> = {
    BUILD: 0,
    REQUIREMENT: 1,
    UNKNOWN: 1,
    ASSEMBLY: 2,
    PART: 3,
    MATERIAL: 4,
    PROCESS: 4,
    FINISH: 4,
    SUPPLIER: 5,
    SHOP: 5,
    QUOTE: 5,
    ORDER: 6,
    QA: 6,
    SHIPMENT: 6,
    PASSPORT: 6,
};

/** Build node pill per trust state: never READY before the build has real manufacturing evidence. */
const TRUST_PILL: Record<BuildTrustState, UniversalStatus> = {
    CONCEPT: 'DRAFT',
    ENGINEERING_REVIEW: 'REVIEW',
    MANUFACTURING_READY: 'READY',
    SUPPLIER_CONFIRMED: 'READY',
    ORDERABLE: 'READY',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** State + pill + secondary line for one persisted node. AI output always reads as a draft. */
function viewNodeState(n: BgNode, view: BuildGraphView): Pick<BuildGraphNode, 'state' | 'status' | 'value'> {
    const d = n.data ?? {};
    if (n.type === 'BUILD') {
        if (d.role === 'source') return { state: 'done', status: 'COMPLETE', value: `${str(d.displayId) ?? 'Source build'} · v${typeof d.version === 'number' ? d.version : '?'}` };
        return { state: 'active', status: TRUST_PILL[view.build.trustState], value: `${view.build.displayId} · v${view.version.version}` };
    }
    if (n.type === 'UNKNOWN') {
        if (d.status === 'open') return { state: 'active', status: 'NEEDS_INPUT', value: 'Needs your answer' };
        return { state: 'done', status: 'COMPLETE', value: str(d.answer) ? `Answer: ${str(d.answer)}` : 'Answered' };
    }
    if (d.needsSourcing === true) return { state: 'pending', status: 'REVIEW', value: 'Needs sourcing' };
    if (n.source === 'user') return { state: 'done', status: 'READY', value: 'You said' };
    if (n.source === 'quote_engine' || n.source === 'ops') return { state: 'done', status: 'READY', value: null };
    let value: string | null = null;
    if (n.type === 'REQUIREMENT') value = [str(d.category), n.confidence !== null ? `${Math.round(n.confidence * 100)}% sure` : null].filter(Boolean).join(' · ') || null;
    else if (n.type === 'MATERIAL') value = [str(d.role), n.confidence !== null ? `${Math.round(n.confidence * 100)}% sure` : null].filter(Boolean).join(' · ') || null;
    else if (n.type === 'PART') value = d.dimensionsStatus === 'stated' ? 'Dimensions stated' : 'Dimensions needed';
    else if (n.type === 'PROCESS' || n.type === 'FINISH') value = d.inCatalog === true ? 'In catalog' : null;
    return { state: 'pending', status: 'DRAFT', value };
}

/** BuildGraphView -> display graph for `GraphView` (node ids are the stable node keys). */
export function buildGraphFromView(view: BuildGraphView): BuildGraph {
    const used = [...new Set(view.nodes.map((n) => BG_COLUMN[n.type]))].sort((a, b) => a - b);
    const columnOf = new Map(used.map((c, i) => [c, i]));
    const rowsIn = new Map<number, number>();
    const nodes: BuildGraphNode[] = view.nodes.map((n) => {
        const column = columnOf.get(BG_COLUMN[n.type]) ?? 0;
        const row = rowsIn.get(column) ?? 0;
        rowsIn.set(column, row + 1);
        const display = BG_NODE_DISPLAY[n.type];
        return { id: n.key, type: display.type, typeLabel: display.typeLabel, label: n.label, ...viewNodeState(n, view), column, row };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: BuildGraphEdge[] = [];
    for (const e of view.edges) {
        const source = byId.get(e.fromKey);
        const target = byId.get(e.toKey);
        if (!source || !target) continue;
        edges.push({ id: `${e.type}:${e.fromKey}->${e.toKey}`, type: e.type, source: source.id, target: target.id, state: edgeState(source, target) });
    }
    return { nodes, edges, columns: Math.max(1, used.length), rows: Math.max(1, ...rowsIn.values()) };
}
