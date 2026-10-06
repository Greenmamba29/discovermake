import { describe, expect, it } from 'vitest';
import { OrderView, TRACKING_STEPS, type OrderStatus, type TrackingStep } from '@/contracts';
import { BUILD_GRAPH_EDGE_TYPES, BUILD_GRAPH_NODE_TYPES, GRAPH_LAYOUT, buildGraphFromOrder, describeNode, layoutBuildGraph, type BuildGraph } from './build-graph';

const T = '2026-10-06T12:00:00.000Z';

/** Mirrors the tracker step derivation in src/server/orders/buyer-view.ts for the statuses under test. */
function steps(current: number, state: TrackingStep['state'] = 'current'): TrackingStep[] {
    return TRACKING_STEPS.map((key, i) => ({
        key,
        label: key,
        state: i < current ? 'done' : i === current ? state : 'upcoming',
        at: i <= current ? T : null,
    }));
}

const UNIVERSAL: Partial<Record<OrderStatus, OrderView['universalStatus']>> = {
    PAID: 'READY',
    IN_PRODUCTION: 'IN_PRODUCTION',
    QA_FAILED: 'IN_PRODUCTION',
    SHIPPED: 'IN_PRODUCTION',
    COMPLETE: 'COMPLETE',
    CANCELLED: 'CANCELLED',
};

const shop = { name: 'Philadelphia Precision Works', city: 'Philadelphia', region: 'PA', rating: 4.8 };

const shipment = {
    id: 'shp_1',
    orderId: 'ord_1',
    jobId: 'job_1',
    provider: 'manual' as const,
    carrier: 'UPS',
    service: 'Ground',
    trackingNumber: '1Z999AA10123456784',
    trackingUrl: null,
    labelUrl: null,
    status: 'IN_TRANSIT' as const,
    events: [],
    estimatedDeliveryDate: '2026-10-14',
    shippedAt: T,
    deliveredAt: null,
    createdAt: T,
};

/** A contract-valid OrderView (parsed, so contract drift fails the test). */
function order(status: OrderStatus, patch: Partial<OrderView> = {}): OrderView {
    const base: OrderView = {
        id: 'ord_1',
        orderNumber: 'DM-1001',
        status,
        universalStatus: UNIVERSAL[status] ?? 'READY',
        statusLabel: 'status',
        progressPct: 50,
        orderType: 'PROTOTYPE',
        build: { id: 'bld_1', displayId: 'DM-7K3QX', name: 'Sensor bracket' },
        quoteId: 'qte_1',
        designVersion: 2,
        summary: {
            materialName: 'Aluminum 6061',
            thicknessLabel: '0.090"',
            processName: 'Fiber laser',
            finishName: 'Powder coat',
            serviceNames: ['Bending', 'Deburr'],
            quantity: 10,
            partFilename: 'bracket.dxf',
            bboxWidthMm: 120,
            bboxHeightMm: 80.5,
            unitMassG: 60,
        },
        preview: null,
        unitPriceCents: 2350,
        subtotalCents: 23500,
        shippingCents: 1200,
        taxCents: 0,
        totalCents: 24700,
        currency: 'usd',
        shippingMethod: 'STANDARD',
        shippingAddress: { name: 'Ada', line1: '1 Main St', city: 'Philadelphia', region: 'PA', postalCode: '19103', country: 'US' },
        buyer: { name: 'Ada', email: 'ada@example.com' },
        promisedShipDate: '2026-10-12',
        steps: steps(1),
        timeline: [],
        shop: null,
        milestones: [],
        inspection: null,
        shipment: null,
        passport: null,
        createdAt: T,
        paidAt: T,
        deliveredAt: null,
    };
    return OrderView.parse({ ...base, ...patch });
}

const ids = (g: BuildGraph) => g.nodes.map((n) => n.id);
const node = (g: BuildGraph, id: string) => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`node ${id} missing`);
    return n;
};

describe('buildGraphFromOrder', () => {
    it('PAID: design locked, material queued, no shop / QA / shipment / passport invented', () => {
        const g = buildGraphFromOrder(order('PAID', { steps: steps(1) }));
        expect(ids(g)).toEqual(['build', 'part', 'material', 'process', 'service-0', 'service-1']);
        expect(node(g, 'build')).toMatchObject({ type: 'Build', label: 'Sensor bracket', value: 'DM-7K3QX · design v2', state: 'done', status: 'COMPLETE' });
        expect(node(g, 'part')).toMatchObject({ type: 'Part', label: 'bracket.dxf', value: '10 pcs · 120 × 80.5 mm', state: 'done' });
        expect(node(g, 'material')).toMatchObject({ type: 'MaterialSpec', label: 'Aluminum 6061', value: '0.090" · Powder coat', state: 'active', status: 'READY' });
        expect(node(g, 'process')).toMatchObject({ type: 'ProcessPlan', label: 'Fiber laser', state: 'pending', status: 'DRAFT' });
        expect(node(g, 'service-1')).toMatchObject({ type: 'ProcessPlan', label: 'Deburr', column: 3, row: 2 });
        expect(g.columns).toBe(4);
        expect(g.rows).toBe(3);

        expect(g.edges.map((e) => [e.type, e.source, e.target, e.state])).toEqual([
            ['CONTAINS', 'build', 'part', 'done'],
            ['MADE_OF', 'part', 'material', 'active'],
            ['REQUIRES_PROCESS', 'material', 'process', 'pending'],
            ['REQUIRES_PROCESS', 'material', 'service-0', 'pending'],
            ['REQUIRES_PROCESS', 'material', 'service-1', 'pending'],
        ]);
    });

    it('IN_PRODUCTION: material done, processes + shop active, QA node only once inspection starts', () => {
        const milestones = [{ id: 'mst_1', jobId: 'job_1', kind: 'CUTTING' as const, label: 'Cutting', note: null, occurredAt: T }];
        const g = buildGraphFromOrder(order('IN_PRODUCTION', { steps: steps(2), shop, milestones }));
        expect(ids(g)).toEqual(['build', 'part', 'material', 'process', 'service-0', 'service-1', 'shop']);
        expect(node(g, 'material').state).toBe('done');
        expect(node(g, 'process')).toMatchObject({ state: 'active', status: 'IN_PRODUCTION' });
        expect(node(g, 'shop')).toMatchObject({ type: 'Facility', label: shop.name, value: 'Philadelphia, PA', state: 'active', column: 4 });
        const toShop = g.edges.filter((e) => e.target === 'shop');
        expect(toShop.map((e) => e.source)).toEqual(['process', 'service-0', 'service-1']);
        expect(new Set(toShop.map((e) => e.type))).toEqual(new Set(['MANUFACTURED_BY']));
        expect(toShop.every((e) => e.state === 'active')).toBe(true);

        const inQa = buildGraphFromOrder(
            order('IN_PRODUCTION', { steps: steps(2), shop, milestones: [...milestones, { ...milestones[0], id: 'mst_2', kind: 'QA', label: 'QA' }] }),
        );
        expect(node(inQa, 'qa')).toMatchObject({ type: 'InspectionResult', value: 'Inspection under way', state: 'active' });
        expect(inQa.edges.find((e) => e.target === 'qa')).toMatchObject({ type: 'INSPECTED_BY', source: 'shop' });
    });

    it('SHIPPED: production chain done, shipment active with tracking + ETA, no passport yet', () => {
        const g = buildGraphFromOrder(
            order('SHIPPED', { steps: steps(4), shop, inspection: { outcome: 'PASS', at: T }, shipment }),
        );
        expect(ids(g)).toEqual(['build', 'part', 'material', 'process', 'service-0', 'service-1', 'shop', 'qa', 'shipment']);
        for (const id of ['material', 'process', 'shop', 'qa']) expect(node(g, id).state).toBe('done');
        expect(node(g, 'qa').value).toMatch(/^Passed · /);
        expect(node(g, 'shipment')).toMatchObject({ type: 'Shipment', label: 'UPS Ground', state: 'active', status: 'IN_PRODUCTION' });
        expect(node(g, 'shipment').value).toMatch(/^1Z999AA10123456784 · arrives /);
        expect(g.edges.find((e) => e.target === 'shipment')).toMatchObject({ type: 'DELIVERED_BY', source: 'qa', state: 'active' });
    });

    it('COMPLETE: every node done, passport recorded, all edges done', () => {
        const g = buildGraphFromOrder(
            order('COMPLETE', {
                steps: steps(TRACKING_STEPS.length),
                shop,
                inspection: { outcome: 'PASS', at: T },
                shipment: { ...shipment, status: 'DELIVERED', deliveredAt: T },
                passport: { id: 'pps_1', url: 'https://discovermake.test/passport/pps_1', activatedAt: T },
                deliveredAt: T,
            }),
        );
        expect(ids(g).at(-1)).toBe('passport');
        expect(g.nodes.every((n) => n.state === 'done' && n.status === 'COMPLETE')).toBe(true);
        expect(g.edges.every((e) => e.state === 'done')).toBe(true);
        expect(node(g, 'shipment').value).toBe('1Z999AA10123456784');
        expect(g.edges.find((e) => e.target === 'passport')).toMatchObject({ type: 'RECORDED_IN', source: 'shipment' });
        expect(g.edges.every((e) => (BUILD_GRAPH_EDGE_TYPES as readonly string[]).includes(e.type))).toBe(true);
        expect(g.nodes.every((n) => (BUILD_GRAPH_NODE_TYPES as readonly string[]).includes(n.type))).toBe(true);
    });

    it('QA_FAILED: inspection node fails, shop keeps working on the rework', () => {
        const g = buildGraphFromOrder(order('QA_FAILED', { steps: steps(3, 'failed'), shop, inspection: { outcome: 'FAIL', at: T } }));
        expect(node(g, 'qa')).toMatchObject({ state: 'failed', status: 'FAILED', value: 'Failed · part being remade' });
        expect(node(g, 'shop').state).toBe('active');
    });

    it('CANCELLED: unfinished nodes read cancelled, finished ones stay done', () => {
        const g = buildGraphFromOrder(order('CANCELLED', { steps: steps(1, 'failed') }));
        expect(node(g, 'build').state).toBe('done');
        expect(node(g, 'material')).toMatchObject({ state: 'cancelled', status: 'CANCELLED' });
        expect(node(g, 'process').state).toBe('cancelled');
    });

    it('omits empty optional fields instead of inventing them', () => {
        const base = order('PAID');
        const g = buildGraphFromOrder({ ...base, summary: { ...base.summary, finishName: null, serviceNames: [], bboxWidthMm: 0, bboxHeightMm: 0 } });
        expect(node(g, 'material').value).toBe('0.090"');
        expect(node(g, 'part').value).toBe('10 pcs');
        expect(ids(g)).not.toContain('service-0');
    });
});

describe('layoutBuildGraph', () => {
    it('is deterministic left-to-right and centres short columns on the tallest', () => {
        const g = buildGraphFromOrder(order('PAID'));
        const a = layoutBuildGraph(g);
        expect(layoutBuildGraph(g)).toEqual(a);
        const { nodeWidth, nodeHeight, gapX, gapY } = GRAPH_LAYOUT;
        expect(a.get('build')).toEqual({ x: 0, y: nodeHeight + gapY });
        expect(a.get('material')).toEqual({ x: 2 * (nodeWidth + gapX), y: nodeHeight + gapY });
        expect(a.get('process')).toEqual({ x: 3 * (nodeWidth + gapX), y: 0 });
        expect(a.get('service-1')).toEqual({ x: 3 * (nodeWidth + gapX), y: 2 * (nodeHeight + gapY) });
    });
});

describe('describeNode', () => {
    it('reads as one plain sentence with the relationship', () => {
        const g = buildGraphFromOrder(order('PAID'));
        expect(describeNode(node(g, 'material'), g, 'Ready')).toBe('Material: Aluminum 6061. 0.090" · Powder coat. Status: Ready. Linked from bracket.dxf made of Aluminum 6061.');
    });
});
