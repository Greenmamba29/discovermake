// @vitest-environment jsdom
/**
 * Home intake routing (Uber "Where to?"): typed text → Make AI prefilled; a DXF (attached or
 * dropped) → the real upload → analyze pipeline → the configurator. Network stubbed at fetch().
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => '/' }));
// The signed PUT goes through XMLHttpRequest; everything else is the real client.
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), putSigned: vi.fn(async () => undefined) }));

import { part } from '../__fixtures__/contracts';
import { HomeIntake } from './home-intake';
import { makeAiPromptHref, routeIntake } from './intake';

const calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
    calls.length = 0;
    nav.push.mockReset();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
            const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
            if (url === '/api/parts' && method === 'POST') {
                return ok({ partId: 'prt_home1', buildId: 'bld_home1', upload: { url: 'http://localhost/api/storage/local/x', method: 'PUT', headers: {}, expiresAt: '2026-10-09T00:00:00.000Z' } }, 201);
            }
            if (url === '/api/parts/prt_home1/analyze') return ok({ ...part, id: 'prt_home1' });
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const dxf = (name = 'bracket.dxf') => new File(['0\nSECTION\n0\nEOF\n'], name, { type: 'application/dxf' });

describe('routeIntake', () => {
    it('routes text to Make AI with the prompt encoded', () => {
        expect(routeIntake({ text: '  A bracket & a 20% stronger hinge ', makeAiEnabled: true })).toEqual({ kind: 'make-ai', href: '/make/ai?prompt=A%20bracket%20%26%20a%2020%25%20stronger%20hinge' });
    });
    it('a file wins over text', () => {
        const file = dxf();
        expect(routeIntake({ text: 'ignored', file, makeAiEnabled: true })).toEqual({ kind: 'upload', file });
    });
    it('empty input and disabled Make AI are explicit outcomes', () => {
        expect(routeIntake({ text: '   ', makeAiEnabled: true }).kind).toBe('empty');
        expect(routeIntake({ text: 'a shelf', makeAiEnabled: false }).kind).toBe('make-ai-disabled');
    });
    it('caps the prompt at the Make AI input limit', () => {
        expect(decodeURIComponent(makeAiPromptHref('x'.repeat(5000)).split('=')[1])).toHaveLength(2000);
    });
});

describe('HomeIntake', () => {
    it('typed text lands on Make AI prefilled', () => {
        render(<HomeIntake makeAiEnabled />);
        fireEvent.change(screen.getByLabelText('Describe what you want to make'), { target: { value: 'A wall bracket for a 600 mm shelf' } });
        fireEvent.click(screen.getByTestId('intake-submit'));
        expect(nav.push).toHaveBeenCalledWith('/make/ai?prompt=A%20wall%20bracket%20for%20a%20600%20mm%20shelf');
        expect(calls).toHaveLength(0);
    });

    it('asks for input instead of navigating when the bar is empty', async () => {
        render(<HomeIntake makeAiEnabled />);
        fireEvent.click(screen.getByTestId('intake-submit'));
        expect((await screen.findByRole('alert')).textContent).toMatch(/describe what you want to make, or attach a dxf/i);
        expect(nav.push).not.toHaveBeenCalled();
    });

    it('explains the preview when Make AI is off, and never routes text to a 404', async () => {
        render(<HomeIntake makeAiEnabled={false} />);
        fireEvent.change(screen.getByLabelText('Describe what you want to make'), { target: { value: 'A shelf' } });
        fireEvent.click(screen.getByTestId('intake-submit'));
        expect((await screen.findByRole('alert')).textContent).toMatch(/private preview/i);
        expect(nav.push).not.toHaveBeenCalled();
    });

    it('an attached DXF runs the upload pipeline and opens the configurator', async () => {
        render(<HomeIntake makeAiEnabled />);
        fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [dxf()] } });
        await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/parts/prt_home1'));
        expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/parts', 'POST /api/parts/prt_home1/analyze']);
        expect(calls[0].body).toMatchObject({ filename: 'bracket.dxf', contentType: 'application/dxf' });
    });

    it('a dropped DXF takes the same path', async () => {
        render(<HomeIntake makeAiEnabled />);
        fireEvent.drop(screen.getByTestId('intake-bar'), { dataTransfer: { files: [dxf('dropped.dxf')] } });
        await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/parts/prt_home1'));
    });

    it('rejects non-DXF files before any request', async () => {
        render(<HomeIntake makeAiEnabled />);
        fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [dxf('model.step')] } });
        expect((await screen.findByRole('alert')).textContent).toMatch(/STEP, STL/);
        expect(calls).toHaveLength(0);
    });
});
