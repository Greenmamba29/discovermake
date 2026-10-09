// @vitest-environment jsdom
/**
 * Object View without WebGL (jsdom has none): the fallback renders with the dimensions as text,
 * units toggle, downloads, the 2D flat pattern when a DXF part exists, the honest empty state
 * without CAD, and the light Overview card. three.js is never loaded.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildCadGenerated } from '@/contracts/cad';
import { makeView } from '../workspace.fixtures';
import { ObjectView, ObjectViewCard } from './object-view';

const loaded = vi.hoisted(() => ({ viewer: 0 }));
vi.mock('next/dynamic', () => ({
    default: () => {
        loaded.viewer++;
        return () => <div data-testid="viewer-3d" />;
    },
}));

const RECORD: BuildCadGenerated = {
    status: 'generated',
    version: 3,
    family: 'l_bracket',
    spec: { family: 'l_bracket', leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 2, inside_bend_radius_mm: 2, k_factor: 0.44, holes_a: [], holes_b: [] },
    metrics: { bbox_mm: [80, 40, 50], volume_mm3: 9700, bend_count: 1, thickness_mm: 2 },
    processes: ['laser cutting', 'press brake bending'],
    warnings: [],
    dropped: [],
    artifacts: [
        { kind: 'GLB', filename: 'bracket.glb', bytes: 4096, sha256: 'a'.repeat(64), url: 'http://localhost:3100/api/storage/local/builds/b/cad/v3/bracket.glb?sig=1', expiresAt: '2026-10-09T00:15:00.000Z' },
        { kind: 'STEP', filename: 'bracket.step', bytes: 40000, sha256: 'b'.repeat(64), url: 'http://localhost:3100/api/storage/local/builds/b/cad/v3/bracket.step?sig=1', expiresAt: '2026-10-09T00:15:00.000Z' },
        { kind: 'DXF', filename: 'bracket_flat.dxf', bytes: 2048, sha256: 'c'.repeat(64), url: 'http://localhost:3100/api/storage/local/builds/b/cad/v3/bracket_flat.dxf?sig=1', expiresAt: '2026-10-09T00:15:00.000Z' },
    ],
    partId: null,
    partStatus: null,
    quotable: false,
};

let cad: BuildCadGenerated | null = null;
const PREVIEW = { widthMm: 130, heightMm: 40, svgPath: 'M0 0H130V40H0Z', outer: [], holes: [], bendLines: [] };

beforeEach(() => {
    cad = RECORD;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
            if (url.endsWith('/cad')) return ok(cad);
            if (url.includes('/api/parts/prt_flat')) return ok({ id: 'prt_flat', preview: PREVIEW });
            return new Response('{}', { status: 404 });
        }),
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderWith(node: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('ObjectView without WebGL', () => {
    it('falls back to a dimensioned drawing with the size as text, and never mounts the 3D viewer', async () => {
        const onGo = vi.fn();
        renderWith(<ObjectView view={makeView()} onGo={onGo} />);
        expect(await screen.findByTestId('object-fallback')).toBeTruthy();
        expect(screen.queryByTestId('viewer-3d')).toBeNull();
        expect(screen.getByTestId('object-static-preview').getAttribute('aria-label')).toMatch(/80\.0 mm wide \(X\), 40\.0 mm deep \(Y\), 50\.0 mm tall \(Z\)/);
        expect(screen.getByTestId('object-fallback-reason').textContent).toMatch(/WebGL/);

        const dims = screen.getByTestId('object-dimensions');
        expect(within(dims).getByTestId('object-dim-X').textContent).toBe('80.0 mm');
        expect(within(dims).getByTestId('object-dim-Z').textContent).toBe('50.0 mm');
        expect(screen.getByTestId('object-summary').textContent).toBe('Overall size 80.0 mm wide (X), 40.0 mm deep (Y), 50.0 mm tall (Z).');

        // Units toggle (real buttons with aria-pressed).
        const inches = screen.getByTestId('object-unit-in');
        expect(inches.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(inches);
        expect(inches.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('object-dim-X').textContent).toBe('3.150 in');

        // 3D-only tools are disabled, downloads are offered in STEP / DXF / GLB order.
        expect((screen.getByTestId('object-measure') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('object-reset') as HTMLButtonElement).disabled).toBe(true);
        const links = within(screen.getByTestId('object-downloads')).getAllByRole('link');
        expect(links.map((a) => a.getAttribute('data-testid'))).toEqual(['object-download-STEP', 'object-download-DXF', 'object-download-GLB']);
        expect(links[0]!.getAttribute('download')).toBe('bracket.step');

        fireEvent.click(screen.getByTestId('object-ask-make-ai'));
        expect(onGo).toHaveBeenCalledWith('assistant');
    });

    it('shows the 2D flat pattern when the CAD record has a DXF part', async () => {
        cad = { ...RECORD, partId: 'prt_flat' };
        renderWith(<ObjectView view={makeView()} onGo={() => undefined} />);
        expect(await screen.findByRole('img', { name: /Flat pattern, 130\.0 by 40\.0 millimetres/ })).toBeTruthy();
        expect(screen.getByTestId('object-fallback-reason').textContent).toMatch(/2D flat pattern/);
    });

    it('says honestly that there is no model before CAD exists', async () => {
        cad = null;
        const onGo = vi.fn();
        renderWith(<ObjectView view={makeView()} onGo={onGo} />);
        expect(await screen.findByText('Generate CAD to see the 3D model')).toBeTruthy();
        fireEvent.click(screen.getByTestId('object-go-cad'));
        expect(onGo).toHaveBeenCalledWith('overview');
    });
});

describe('ObjectViewCard (Overview)', () => {
    it('shows a static preview and dimensions, then opens the Object section', async () => {
        const onGo = vi.fn();
        renderWith(<ObjectViewCard view={makeView()} onGo={onGo} />);
        expect((await screen.findByTestId('object-card-dims')).textContent).toBe('80.0 × 40.0 × 50.0 mm');
        fireEvent.click(screen.getByTestId('object-card-open'));
        expect(onGo).toHaveBeenCalledWith('object');
    });

    it('prompts to generate CAD when there is none', async () => {
        cad = null;
        renderWith(<ObjectViewCard view={makeView()} onGo={() => undefined} />);
        expect((await screen.findByTestId('object-card-empty')).textContent).toMatch(/Generate CAD/);
    });
});
