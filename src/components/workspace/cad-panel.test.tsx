// @vitest-environment jsdom
/**
 * CadPanel: generate controls only for an approved latest version with no open questions,
 * the generated result (downloads + instant-quote link), needs_input copy and manual entry.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildCadGenerated } from '@/contracts/cad';
import { CadPanel } from './cad-panel';
import { makeView } from './workspace.fixtures';

const APPROVED = makeView({
    nodes: makeView().nodes.filter((n) => n.type !== 'UNKNOWN'),
    versions: [{ version: 1, status: 'APPROVED', summary: 'Drafted by Make AI', createdAt: '2026-10-07T00:00:00.000Z' }],
});

const GENERATED: BuildCadGenerated = {
    status: 'generated',
    version: 2,
    family: 'l_bracket',
    spec: { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, inside_bend_radius_mm: 1.52, k_factor: 0.44, holes_a: [], holes_b: [] },
    metrics: { bbox_mm: [80, 40, 50], volume_mm3: 9700, bend_count: 1 },
    processes: ['laser cutting', 'press brake bending'],
    warnings: [],
    dropped: ['leg B hole at (20, 33) d=5: position not given by the buyer'],
    artifacts: [{ kind: 'STEP', filename: 'bracket.step', bytes: 40000, sha256: 'a'.repeat(64), url: 'http://localhost:3100/api/storage/local/x', expiresAt: '2026-10-07T00:15:00.000Z' }],
    partId: 'prt_cad1',
    partStatus: 'READY',
    quotable: true,
};

let cad: BuildCadGenerated | null;
let postBodies: unknown[];
let postResponse: unknown;

beforeEach(() => {
    cad = null;
    postBodies = [];
    postResponse = GENERATED;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (init?.method === 'POST') {
                postBodies.push(JSON.parse(String(init.body)));
                if (postResponse && (postResponse as { status: string }).status === 'generated') cad = GENERATED;
                return ok(postResponse, 201);
            }
            return ok(cad);
        }),
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderPanel(view = APPROVED, isCurrent = true) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CadPanel view={view} isCurrent={isCurrent} />
        </QueryClientProvider>,
    );
}

describe('CadPanel', () => {
    it('hides generate controls while questions are open', async () => {
        renderPanel(makeView());
        expect(await screen.findByText(/No geometry yet/)).toBeTruthy();
        expect(screen.queryByTestId('cad-generate-ai')).toBeNull();
    });

    it('generates with Make AI and then offers downloads and the instant quote', async () => {
        renderPanel();
        fireEvent.click(await screen.findByTestId('cad-generate-ai'));
        expect(await screen.findByTestId('cad-result')).toBeTruthy();
        expect(postBodies).toEqual([{}]);
        expect(screen.getByTestId('cad-instant-quote').getAttribute('href')).toBe('/parts/prt_cad1');
        expect(screen.getByTestId('cad-download-STEP').getAttribute('href')).toBe('http://localhost:3100/api/storage/local/x');
        expect(screen.getByText(/Left out because you did not specify them/)).toBeTruthy();
    });

    it('explains needs_input instead of guessing', async () => {
        postResponse = { status: 'needs_input', version: 2, questions: ['What leg a (in mm) do you need?'] };
        renderPanel();
        fireEvent.click(await screen.findByTestId('cad-generate-ai'));
        expect((await screen.findByTestId('cad-needs-input')).textContent).toMatch(/instead of guessing/);
    });

    it('validates manual dimensions before sending them', async () => {
        renderPanel();
        fireEvent.click(await screen.findByTestId('cad-manual-toggle'));
        fireEvent.change(screen.getByTestId('cad-field-leg_a_mm'), { target: { value: '50' } });
        fireEvent.click(screen.getByTestId('cad-manual-submit'));
        expect((await screen.findByRole('alert')).textContent).toMatch(/Leg B/);
        expect(postBodies).toEqual([]);
        for (const [k, v] of [['leg_b_mm', '80'], ['width_mm', '40'], ['thickness_mm', '1.52'], ['inside_bend_radius_mm', '1.52']]) {
            fireEvent.change(screen.getByTestId(`cad-field-${k}`), { target: { value: v } });
        }
        fireEvent.click(screen.getByTestId('cad-manual-submit'));
        await waitFor(() => expect(postBodies).toHaveLength(1));
        expect(postBodies[0]).toMatchObject({ spec: { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40 } });
    });
});
