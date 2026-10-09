// @vitest-environment jsdom
/**
 * Discover filtering: interest chips filter the starter grid; the visitor's onboarding picks
 * from GET /api/me apply on load; a 404 from the account API just shows everything.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEREST_SLUGS, type MeResponse } from '@/contracts/account';
import { DISCOVER_CATALOG, filterCatalog } from '@/lib/discover-catalog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/discover' }));

import { DiscoverCatalog } from './discover-catalog';

let me: MeResponse | null = null;

beforeEach(() => {
    me = null;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            if (String(input) === '/api/me' && me) return new Response(JSON.stringify(me), { status: 200, headers: { 'content-type': 'application/json' } });
            return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nope' } }), { status: 404 });
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderCatalog(makeAiEnabled = true) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <DiscoverCatalog makeAiEnabled={makeAiEnabled} />
        </QueryClientProvider>,
    );
}

const cards = () => within(screen.getByTestId('discover-grid')).getAllByRole('article');

describe('filterCatalog', () => {
    it('shows everything with no selection and keeps order', () => {
        expect(filterCatalog(DISCOVER_CATALOG, []).map((i) => i.slug)).toEqual(DISCOVER_CATALOG.map((i) => i.slug));
    });
    it('matches any selected interest', () => {
        const got = filterCatalog(DISCOVER_CATALOG, ['garden', 'jewelry']);
        expect(got.length).toBeGreaterThan(0);
        for (const item of got) expect(item.interests.some((s) => s === 'garden' || s === 'jewelry')).toBe(true);
        expect(got.map((i) => i.slug)).toContain('plant-markers');
        expect(got.map((i) => i.slug)).toContain('hex-pendant');
    });
    it('every interest from onboarding has at least one starter', () => {
        for (const slug of INTEREST_SLUGS) expect(filterCatalog(DISCOVER_CATALOG, [slug]).length, slug).toBeGreaterThan(0);
    });
    it('every starter is a real flow: a bundled DXF with a preset, or a precise Make AI prompt', () => {
        for (const item of DISCOVER_CATALOG) {
            if (item.start.kind === 'quote') {
                expect(item.start.dxf()).toMatch(/\$INSUNITS\n70\n4\n/);
                expect(item.start.preset.materialId).toMatch(/^mat_/);
            } else {
                expect(item.start.prompt.length).toBeGreaterThan(60);
            }
        }
    });
});

describe('DiscoverCatalog', () => {
    it('chips filter the grid and "All" resets it (account API absent)', async () => {
        renderCatalog();
        expect(cards()).toHaveLength(DISCOVER_CATALOG.length);
        fireEvent.click(screen.getByTestId('interest-filter-camping'));
        expect(screen.getByTestId('interest-filter-camping').getAttribute('aria-pressed')).toBe('true');
        const camping = filterCatalog(DISCOVER_CATALOG, ['camping']);
        expect(cards()).toHaveLength(camping.length);
        expect(screen.getByTestId('discover-count').textContent).toMatch(new RegExp(`^${camping.length} starter`));
        fireEvent.click(screen.getByTestId('interest-filter-drones'));
        expect(cards()).toHaveLength(filterCatalog(DISCOVER_CATALOG, ['camping', 'drones']).length);
        fireEvent.click(screen.getByTestId('interest-filter-all'));
        expect(cards()).toHaveLength(DISCOVER_CATALOG.length);
    });

    it("applies the visitor's onboarding interests from GET /api/me", async () => {
        me = { viewer: null, preferences: { intent: 'make', interests: ['jewelry'] }, providers: ['email'], passkeys: [] };
        renderCatalog();
        await waitFor(() => expect(cards()).toHaveLength(filterCatalog(DISCOVER_CATALOG, ['jewelry']).length));
        expect(screen.getByTestId('discover-count').textContent).toMatch(/picked from your interests/);
        expect(screen.getByTestId('interest-filter-jewelry').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
        expect(cards()).toHaveLength(DISCOVER_CATALOG.length);
    });

    it('Make AI starters link to a prefilled Make AI, or explain the preview when it is off', () => {
        const { unmount } = renderCatalog(true);
        const link = screen.getByTestId('discover-start-drone-frame');
        expect(link.getAttribute('href')).toMatch(/^\/make\/ai\?prompt=A%205-inch%20FPV%20drone%20frame/);
        unmount();
        renderCatalog(false);
        expect(screen.queryByTestId('discover-start-drone-frame')).toBeNull();
        expect(screen.getAllByText(/Make AI is in private preview/).length).toBeGreaterThan(0);
        // Instant-quote starters never depend on Make AI.
        expect(screen.getByTestId('discover-start-wall-bracket').tagName).toBe('BUTTON');
    });
});
