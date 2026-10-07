// @vitest-environment jsdom
/**
 * Build Graph panel: collapsed on mobile, open on desktop, renders the xyflow canvas
 * read-only with focusable nodes and a screen-reader list of the same nodes.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRACKING_STEPS, type OrderView } from '@/contracts';
import { buildGraphFromOrder } from '@/lib/build-graph';
import { GraphView } from './GraphView';
import { BuildGraphSection } from './BuildGraphPanel';

// next/dynamic resolves asynchronously; render the real module synchronously in tests.
vi.mock('next/dynamic', async () => {
    const mod = await import('./GraphView');
    return { default: () => mod.default };
});

const T = '2026-10-06T12:00:00.000Z';
const order: OrderView = {
    id: 'ord_1',
    orderNumber: 'DM-1001',
    status: 'IN_PRODUCTION',
    universalStatus: 'IN_PRODUCTION',
    statusLabel: 'Cutting now',
    progressPct: 55,
    orderType: 'PROTOTYPE',
    build: { id: 'bld_1', displayId: 'DM-7K3QX', name: 'Sensor bracket' },
    quoteId: 'qte_1',
    designVersion: 1,
    summary: { materialName: 'Aluminum 6061', thicknessLabel: '0.090"', processName: 'Fiber laser', finishName: null, serviceNames: [], quantity: 4, partFilename: 'bracket.dxf', bboxWidthMm: 120, bboxHeightMm: 80, unitMassG: 60 },
    preview: null,
    unitPriceCents: 2350,
    subtotalCents: 9400,
    shippingCents: 1200,
    taxCents: 0,
    totalCents: 10600,
    currency: 'usd',
    shippingMethod: 'STANDARD',
    shippingAddress: { name: 'Ada', line1: '1 Main St', city: 'Philadelphia', region: 'PA', postalCode: '19103', country: 'US' },
    buyer: { name: 'Ada', email: 'ada@example.com' },
    promisedShipDate: '2026-10-12',
    steps: TRACKING_STEPS.map((key, i) => ({ key, label: key, state: i < 2 ? 'done' : i === 2 ? 'current' : 'upcoming', at: i <= 2 ? T : null })),
    timeline: [],
    shop: { name: 'Philadelphia Precision Works', city: 'Philadelphia', region: 'PA', rating: null },
    milestones: [],
    inspection: null,
    shipment: null,
    passport: null,
    createdAt: T,
    paidAt: T,
    deliveredAt: null,
};

function stubMatchMedia(matches: (q: string) => boolean) {
    vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: matches(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), onchange: null, addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })),
    );
}

beforeEach(() => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('BuildGraphSection', () => {
    it('is collapsed on mobile and expands on demand', () => {
        stubMatchMedia(() => false);
        render(<BuildGraphSection order={order} />);
        const toggle = screen.getByRole('button', { name: /build graph/i });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('build-graph-canvas')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('build-graph-canvas')).toBeTruthy();
    });

    it('is open by default on desktop', () => {
        stubMatchMedia((q) => q.includes('min-width'));
        render(<BuildGraphSection order={order} />);
        expect(screen.getByRole('button', { name: /build graph/i }).getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('build-graph-canvas')).toBeTruthy();
    });
});

describe('GraphView', () => {
    it('renders read-only, focusable nodes and a screen-reader list of the same nodes', () => {
        stubMatchMedia((q) => q.includes('reduce'));
        const graph = buildGraphFromOrder(order);
        render(<GraphView graph={graph} />);
        const list = screen.getByRole('list', { name: /build graph, in order/i });
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(graph.nodes.length);
        expect(items[2].textContent).toBe('Material: Aluminum 6061. 0.090". Status: Complete. Linked from bracket.dxf made of Aluminum 6061.');
        expect(items.at(-1)?.textContent).toMatch(/^Shop: Philadelphia Precision Works/);

        const shopNode = document.querySelector('[data-id="shop"]');
        expect(shopNode).not.toBeNull();
        expect(shopNode?.getAttribute('tabindex')).toBe('0');
        expect(shopNode?.getAttribute('aria-label')).toMatch(/^Shop: Philadelphia Precision Works/);
        expect(shopNode?.classList.contains('draggable')).toBe(false);
    });
});
