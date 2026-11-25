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
    parameters: [],
    origin: 'make_ai',
    changes: [],
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
let sizesReply: unknown = null;
const SC_RECORD: MakeIt3dRecordView = {
    ...RECORD,
    engine: { name: 'solidcraft', version: '0.48.1' },
    parameters: [
        { name: 'L', expression: '60 mm', value: 60, unit: 'mm', comment: 'overall length' },
        { name: 'W', expression: '24 mm', value: 24, unit: 'mm', comment: 'depth front to back' },
    ],
};
let calls: { method: string; url: string; body: unknown }[] = [];

const BASE_QUOTE = quoteFor({ materialId: 'mat_print_petg', thicknessOptionId: 'thk_print_fdm', quantity: 1 });
const QUOTE = { ...BASE_QUOTE, id: 'qte_make3d000000000001', summary: { ...BASE_QUOTE.summary, materialName: 'PETG' } };

beforeEach(() => {
    calls = [];
    sizesReply = null;
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
            if (url.endsWith('/text-to-cad/parameters')) {
                if (sizesReply) return ok(sizesReply);
                const next = { ...status.record!, version: 3, origin: 'parameters' as const, changes: [{ name: 'L', from: '60 mm', to: '80 mm' }], parameters: SC_RECORD.parameters.map((p) => (p.name === 'L' ? { ...p, expression: '80 mm', value: 80 } : p)) };
                status = { ...status, record: next, latestVersion: 3, latestApproved: false };
                return ok({ status: 'generated', version: 3, record: next }, 201);
            }
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

    it('a SolidCraft model shows Change sizes; a change makes the next DRAFT version', async () => {
        status = { ...status, record: SC_RECORD, latestVersion: 2 };
        renderPanel();
        expect((await screen.findByTestId('make3d-record')).textContent).toContain('SolidCraft 0.48.1');
        fireEvent.change(screen.getByTestId('make3d-size-L'), { target: { value: '80 mm' } });
        fireEvent.click(screen.getByTestId('make3d-sizes-submit'));
        await waitFor(() => expect(calls.find((c) => c.url.endsWith('/text-to-cad/parameters'))?.body).toEqual({ changes: { L: '80 mm' } }));
        expect((await screen.findByTestId('make3d-record-changes')).textContent).toBe('L 60 mm → 80 mm');
        expect(screen.getByTestId('make3d-record').textContent).toContain('You changed its sizes');
        expect(screen.getByTestId('make3d-approve').textContent).toContain('Approve version 3');
    });

    it("a size the model can't take shows the engine's reason and keeps the version", async () => {
        status = { ...status, record: SC_RECORD, latestVersion: 2 };
        sizesReply = { status: 'failed', code: 'BUILD_FAILED', message: "Make AI couldn't turn that into a solid shape.", detail: 'Corners: the largest radius that fits is 2.5 mm', attempts: 1 };
        renderPanel();
        fireEvent.change(await screen.findByTestId('make3d-size-L'), { target: { value: '5 mm' } });
        fireEvent.click(screen.getByTestId('make3d-sizes-submit'));
        expect((await screen.findByTestId('make3d-sizes-error')).textContent).toContain('largest radius that fits is 2.5 mm');
        expect(screen.getByTestId('make3d-approve').textContent).toContain('Approve version 2');
    });

    it('a cadgen model has no Change sizes', async () => {
        status = { ...status, record: RECORD, latestVersion: 2 };
        renderPanel();
        await screen.findByTestId('make3d-record');
        expect(screen.queryByTestId('make3d-sizes')).toBeNull();
    });
});
