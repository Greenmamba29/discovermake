// @vitest-environment jsdom
/**
 * Build Workspace: shell + section nav (real data only), status strip, NEEDS_INPUT question
 * cards (one-tap default and typed answers), Graph View, versions + approve, Remix / Make This,
 * and the empty sourcing slot.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildGraphView } from '@/contracts';
import { BuildWorkspace } from './build-workspace';
import { StatusStrip } from './status-strip';
import { WorkspaceSourcingSlot } from './workspace-sourcing-slot';
import { FIXTURE_BUILD_ID, makeView } from './workspace.fixtures';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }));
// next/dynamic resolves asynchronously; render the real canvas synchronously in tests.
vi.mock('next/dynamic', async () => {
    const mod = await import('@/components/build-graph/GraphView');
    return { default: () => mod.default };
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let routes: Record<string, (body: unknown) => { status: number; json: unknown }> = {};

function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
    calls = [];
    nav.push.mockReset();
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), onchange: null, addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ url, method, body });
            const handler = routes[`${method} ${url}`];
            if (!handler) return json(404, { error: { code: 'NOT_FOUND', message: 'Build Graph not found' } });
            const r = handler(body);
            return json(r.status, r.json);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const GRAPH = `/api/builds/${FIXTURE_BUILD_ID}/graph`;

function renderWorkspace() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <BuildWorkspace buildId={FIXTURE_BUILD_ID} />
        </QueryClientProvider>,
    );
}

/** The fixture after answering `unk:U2` with `value`: version 2, one open question left. */
function answeredView(value: string): BuildGraphView {
    const v1 = makeView();
    const nodes = v1.nodes.map((n) => (n.key === 'unk:U2' ? { ...n, data: { ...n.data, status: 'answered', answer: value } } : n));
    nodes.push({ ...v1.nodes[1]!, id: 'bgn_ans', key: 'req:ans_U2', label: value, source: 'user', confidence: null, data: { question: 'How many do you need?', answer: value, category: 'quantity', answers: 'unk:U2' } });
    return makeView({ version: 2, nodes, edges: v1.edges.filter((e) => e.toKey !== 'unk:U2') });
}

describe('BuildWorkspace', () => {
    it('renders the shell, status strip and only the sections that have data', async () => {
        routes = { [`GET ${GRAPH}`]: () => ({ status: 200, json: makeView() }) };
        renderWorkspace();
        expect(await screen.findByRole('heading', { level: 1, name: 'Outdoor electronics enclosure' })).toBeTruthy();
        const navList = screen.getByRole('navigation', { name: 'Build sections' });
        expect(within(navList).getAllByRole('button').map((b) => b.textContent)).toEqual(['Overview', 'Requirements', 'Questions', 'Materials', 'Parts', 'Graph', 'Versions']);
        expect(within(navList).getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');

        const strip = screen.getByTestId('workspace-status-strip');
        expect(within(strip).getByTestId('build-trust-badge').getAttribute('data-trust-state')).toBe('CONCEPT');
        expect(within(strip).getByTestId('workspace-version').textContent).toContain('v1');
        expect(within(strip).getByTestId('workspace-open-questions').textContent).toContain('2 open');
        expect(within(strip).getByTestId('workspace-confidence').textContent).toContain('70%');

        // Overview: next step is the questions; AI output is labelled as an estimate.
        expect(within(screen.getByTestId('workspace-next-action')).getByRole('heading').textContent).toBe('Answer 2 questions');
        expect(screen.getByText('AI estimate — not a quote')).toBeTruthy();

        // Remix / Make This need an approved version.
        expect((screen.getByRole('button', { name: 'Remix' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Make This' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Approve a version to remix or make it.')).toBeTruthy();
    });

    it('accepts a suggested default with one tap and shows the new version', async () => {
        let current = makeView();
        routes = {
            [`GET ${GRAPH}`]: () => ({ status: 200, json: current }),
            [`POST /api/builds/${FIXTURE_BUILD_ID}/answers`]: () => {
                current = answeredView('1');
                return { status: 201, json: current };
            },
        };
        renderWorkspace();
        fireEvent.click(await screen.findByTestId('workspace-open-questions'));
        const card = screen.getByTestId('question-unk:U2');
        expect(within(screen.getByTestId('question-unk:U1')).queryByRole('button', { name: 'Use this default' })).toBeNull();
        fireEvent.click(within(card).getByRole('button', { name: 'Use this default' }));

        await waitFor(() => expect(screen.queryByTestId('question-unk:U2')).toBeNull());
        expect(calls.find((c) => c.method === 'POST')).toEqual({ url: `/api/builds/${FIXTURE_BUILD_ID}/answers`, method: 'POST', body: { answers: [{ unknownKey: 'unk:U2', value: '1' }] } });
        expect(screen.getByTestId('workspace-version').textContent).toContain('v2');
        expect(screen.getByTestId('workspace-open-questions').textContent).toContain('1 open');
        expect(screen.getByText('Answered (1)')).toBeTruthy();
    });

    it('takes a typed answer, validates it client-side and surfaces server errors', async () => {
        routes = {
            [`GET ${GRAPH}`]: () => ({ status: 200, json: makeView() }),
            [`POST /api/builds/${FIXTURE_BUILD_ID}/answers`]: () => ({ status: 409, json: { error: { code: 'CONFLICT', message: 'Question unk:U1 is already answered. Refresh to see the latest version.' } } }),
        };
        renderWorkspace();
        fireEvent.click(await screen.findByTestId('section-questions'));
        const card = screen.getByTestId('question-unk:U1');
        fireEvent.click(within(card).getByRole('button', { name: 'Save answer' }));
        expect(within(card).getByRole('alert').textContent).toMatch(/type an answer/i);
        expect(calls.some((c) => c.method === 'POST')).toBe(false);

        fireEvent.change(within(card).getByLabelText(/your answer: what are the overall dimensions/i), { target: { value: ' 220 × 160 × 90 mm ' } });
        fireEvent.click(within(card).getByRole('button', { name: 'Save answer' }));
        expect(await screen.findByText(/already answered/i)).toBeTruthy();
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ answers: [{ unknownKey: 'unk:U1', value: '220 × 160 × 90 mm' }] });
    });

    it('shows materials (with "needs sourcing"), parts without invented dimensions, and the Graph View', async () => {
        routes = { [`GET ${GRAPH}`]: () => ({ status: 200, json: makeView() }) };
        renderWorkspace();
        fireEvent.click(await screen.findByTestId('section-materials'));
        const poly = screen.getByTestId('material-mat:src-polycarbonate');
        expect(within(poly).getByText('Polycarbonate')).toBeTruthy();
        expect(within(poly).getByText('Needs sourcing')).toBeTruthy();
        expect(within(screen.getByTestId('material-mat:aluminum-5052')).getByText('70% confidence')).toBeTruthy();

        fireEvent.click(screen.getByTestId('section-parts'));
        expect(screen.getByText(/dimensions needed/i)).toBeTruthy();

        fireEvent.click(screen.getByTestId('section-graph'));
        expect(screen.getByTestId('build-graph-canvas')).toBeTruthy();
        const list = screen.getByRole('list', { name: /build graph, in order/i });
        expect(within(list).getAllByRole('listitem')).toHaveLength(9);
        expect(document.querySelector('[data-id="unk:U1"]')).not.toBeNull();
    });

    it('approves a version, then enables Remix / Make This and routes to the new build', async () => {
        const approved = makeView({ versions: [{ version: 1, status: 'APPROVED', summary: 'Drafted by Make AI from your description', createdAt: '2026-10-07T12:00:00.000Z' }] });
        let current = makeView();
        routes = {
            [`GET ${GRAPH}`]: () => ({ status: 200, json: current }),
            [`GET ${GRAPH}?version=1`]: () => ({ status: 200, json: current }),
            [`POST /api/builds/${FIXTURE_BUILD_ID}/versions/1/approve`]: () => {
                current = approved;
                return { status: 200, json: approved };
            },
            [`POST /api/builds/${FIXTURE_BUILD_ID}/clone`]: () => ({ status: 201, json: { buildId: 'bld_clone0001', displayId: 'DM-AAAAA', derivedFromBuildId: FIXTURE_BUILD_ID } }),
        };
        renderWorkspace();
        fireEvent.click(await screen.findByTestId('section-versions'));
        fireEvent.click(screen.getByTestId('approve-v1'));
        fireEvent.click(screen.getByTestId('approve-v1-confirm'));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Make This' }) as HTMLButtonElement).disabled).toBe(false));
        expect(within(screen.getByTestId('version-1')).getByText('Approved')).toBeTruthy();
        expect(screen.queryByTestId('approve-v1')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Make This' }));
        await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/build/bld_clone0001/workspace'));
    });

    it('explains a build without a Build Graph', async () => {
        routes = {};
        renderWorkspace();
        expect(await screen.findByRole('heading', { name: 'No workspace for this build' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Plan with Make AI' }).getAttribute('href')).toBe('/make/ai');
    });
});

describe('StatusStrip', () => {
    it('never dresses a concept up as production-ready', () => {
        render(<StatusStrip view={makeView({ trust: 'CONCEPT' })} />);
        const badge = screen.getByTestId('build-trust-badge');
        expect(badge.getAttribute('data-trust-state')).toBe('CONCEPT');
        expect(badge.querySelector('[title]')!.textContent).toBe('Concept');
        expect(within(badge).getByRole('list').getAttribute('aria-label')).toBe('Build trust: step 1 of 5, Concept');
    });

    it('shows ORDERABLE only when the server derived it', () => {
        render(<StatusStrip view={makeView({ trust: 'ORDERABLE', nodes: [makeView().nodes[0]!], edges: [] })} />);
        expect(screen.getByTestId('build-trust-badge').getAttribute('data-trust-state')).toBe('ORDERABLE');
        expect(screen.getByTestId('workspace-open-questions').textContent).toContain('None open');
        expect(screen.getByText('No AI estimates')).toBeTruthy();
    });
});

describe('WorkspaceSourcingSlot', () => {
    it('renders nothing until the sourcing panel is integrated', () => {
        const { container } = render(<WorkspaceSourcingSlot buildId={FIXTURE_BUILD_ID} designVersion={1} />);
        expect(container.innerHTML).toBe('');
    });
});
