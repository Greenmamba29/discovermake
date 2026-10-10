// @vitest-environment jsdom
/**
 * "Make it in 3D" panel: the honest unavailable state, the failure copy (GATE_REJECTED in the
 * words the brief asks for), a generated DRAFT that must be approved, then the binding quote
 * with checkout. Prices and records come from the (stubbed) server only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MakeIt3dRecordView, MakeIt3dStatus } from '@/contracts/make-it-3d';
import { quoteFor } from '@/components/__fixtures__/contracts';
import { MakeIt3dPanel } from './make-it-3d-panel';
import { makeView } from './workspace.fixtures';

const RECORD: MakeIt3dRecordView = {
    version: 2,
    prompt: 'A desk cable holder with three slots',
    engine: { name: 'cadgen', version: '0.7.20' },
    scriptSha256: 'a'.repeat(64),
    geometry: { bbox_mm: [60, 24, 18], volume_mm3: 19707.9, area_mm2: 6939.4, solids: 1, sound: true },
    minWallMm: 4.36,
    warnings: [],
    attempts: 1,
    artifacts: [{ kind: 'GLB', filename: 'model.glb', bytes: 76428, sha256: 'b'.repeat(64), url: 'http://localhost/x.glb', expiresAt: '2026-10-10T00:00:00.000Z' }],
    generatedAt: '2026-10-10T00:00:00.000Z',
};
const MATERIALS = [{ slug: 'petg', name: 'PETG', process: 'FDM', description: 'Tough.', swatchHex: '#ccc', heatDeflectionC: 70 }];

let status: MakeIt3dStatus;
let makeReply: unknown;
let calls: { method: string; url: string; body: unknown }[] = [];

const BASE_QUOTE = quoteFor({ materialId: 'mat_print_petg', thicknessOptionId: 'thk_print_fdm', quantity: 1 });
const QUOTE = { ...BASE_QUOTE, id: 'qte_make3d000000000001', summary: { ...BASE_QUOTE.summary, materialName: 'PETG' } };

beforeEach(() => {
    calls = [];
    status = { available: true, reason: null, record: null, latestVersion: 1, latestApproved: false, quotable: false, quoteId: null, printMaterials: MATERIALS };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ method, url, body });
            const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
            if (url.endsWith('/text-to-cad') && method === 'GET') return ok(status);
            if (url.endsWith('/text-to-cad')) return ok(makeReply, 200);
            if (url.includes('/approve')) {
                status = { ...status, latestApproved: true, quotable: true };
                return ok(makeView({ version: 2 }));
            }
            if (url.endsWith('/text-to-cad/quote')) return ok(QUOTE, 201);
            return ok({}, 404);
        }),
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderPanel() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MakeIt3dPanel view={makeView()} isCurrent />
        </QueryClientProvider>,
    );
}

describe('MakeIt3dPanel', () => {
    it('shows the honest unavailable state and no form', async () => {
        status = { ...status, available: false, reason: 'Make AI is not connected to a model yet, so it cannot make 3D models.' };
        renderPanel();
        expect((await screen.findByTestId('make3d-unavailable')).textContent).toContain('not connected to a model yet');
        expect(screen.queryByTestId('make3d-form')).toBeNull();
    });

    it('validates the description, then shows GATE_REJECTED in plain words', async () => {
        makeReply = { status: 'failed', code: 'GATE_REJECTED', message: "Make AI couldn't build that safely. Try describing it another way.", detail: null, attempts: 1 };
        renderPanel();
        const prompt = await screen.findByTestId('make3d-prompt');
        fireEvent.change(prompt, { target: { value: 'cup' } });
        fireEvent.click(screen.getByTestId('make3d-submit'));
        expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8 characters/);
        fireEvent.change(prompt, { target: { value: 'A desk cable holder with three slots' } });
        fireEvent.click(screen.getByTestId('make3d-submit'));
        expect((await screen.findByTestId('make3d-failed-GATE_REJECTED')).textContent).toBe("Make AI couldn't build that safely. Try describing it another way.");
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ prompt: 'A desk cable holder with three slots' });
    });

    it('a generated DRAFT must be approved before the binding quote and checkout', async () => {
        status = { ...status, record: RECORD, latestVersion: 2 };
        renderPanel();
        expect((await screen.findByTestId('make3d-record')).textContent).toContain('cadgen 0.7.20');
        expect(screen.queryByTestId('make3d-get-quote')).toBeNull();
        fireEvent.click(screen.getByTestId('make3d-approve'));
        await waitFor(() => expect(calls.some((c) => c.url.endsWith('/versions/2/approve'))).toBe(true));
        fireEvent.click(await screen.findByTestId('make3d-get-quote'));
        expect((await screen.findByTestId('make3d-total')).textContent).toBe('$23.50');
        expect(screen.getByTestId('make3d-checkout').getAttribute('href')).toBe('/checkout/qte_make3d000000000001');
        expect(calls.find((c) => c.url.endsWith('/text-to-cad/quote'))?.body).toEqual({ printMaterialSlug: 'petg', quantity: 1 });
    });
});
