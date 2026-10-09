// @vitest-environment jsdom
/**
 * Ask Make AI panel: the honest unavailable state still offers the manual requirement; an ask
 * shows the answer and a proposal that only a click on Confirm turns into a new version.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildGraphView } from '@/contracts';
import { AssistantPanel } from './assistant-panel';
import { makeView } from './workspace.fixtures';

let available = false;
let calls: { method: string; url: string; body: Record<string, unknown> | undefined }[] = [];
const V2 = makeView({ version: 2 });

beforeEach(() => {
    calls = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ method, url, body });
            const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
            if (method === 'GET') return ok({ available, reason: available ? null : 'Make AI is switched off here, so it cannot answer questions. You can still add a requirement yourself.', version: 1 });
            if (body?.action === 'ask') {
                return ok({
                    status: 'answered',
                    version: 1,
                    answer: 'I can record that for you to confirm.',
                    proposal: { kind: 'add_requirement', text: 'Make it 20 mm wider than stated', category: 'dimension' },
                    guardNote: null,
                    citedKeys: ['req:R1'],
                    model: 'gemini-test',
                    estimateOnly: true,
                });
            }
            return ok(V2, 201);
        }),
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderPanel(onChanged: (v: BuildGraphView) => void = () => undefined) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AssistantPanel view={makeView()} isCurrent onChanged={onChanged} />
        </QueryClientProvider>,
    );
}

describe('AssistantPanel', () => {
    it('shows an honest unavailable state and still adds a requirement by hand', async () => {
        available = false;
        const onChanged = vi.fn();
        renderPanel(onChanged);
        expect((await screen.findByTestId('assistant-unavailable')).textContent).toMatch(/switched off/);
        expect(screen.queryByTestId('assistant-input')).toBeNull();

        fireEvent.change(screen.getByTestId('assistant-manual-text'), { target: { value: 'Fits a 120 mm fan' } });
        fireEvent.change(screen.getByTestId('assistant-manual-category'), { target: { value: 'dimension' } });
        fireEvent.click(screen.getByTestId('assistant-manual-submit'));
        await waitFor(() => expect(onChanged).toHaveBeenCalledWith(V2));
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ action: 'add_requirement', basedOnVersion: 1, text: 'Fits a 120 mm fan', category: 'dimension' });
        expect(screen.getByTestId('assistant-manual-saved').textContent).toBe('Saved as version 2.');
    });

    it('asks, shows the proposal, and writes only on Confirm', async () => {
        available = true;
        const onChanged = vi.fn();
        renderPanel(onChanged);
        fireEvent.change(await screen.findByTestId('assistant-input'), { target: { value: 'Make it 20 mm wider' } });
        fireEvent.click(screen.getByTestId('assistant-ask'));
        expect((await screen.findByTestId('assistant-proposal')).textContent).toMatch(/Make it 20 mm wider than stated/);
        expect(screen.getByText('I can record that for you to confirm.')).toBeTruthy();
        expect(onChanged).not.toHaveBeenCalled();
        expect(calls.filter((c) => c.body?.action === 'confirm')).toHaveLength(0);

        fireEvent.click(screen.getByTestId('assistant-confirm'));
        await waitFor(() => expect(onChanged).toHaveBeenCalledWith(V2));
        expect(calls.find((c) => c.body?.action === 'confirm')!.body).toEqual({
            action: 'confirm',
            basedOnVersion: 1,
            proposal: { kind: 'add_requirement', text: 'Make it 20 mm wider than stated', category: 'dimension' },
        });
        expect((await screen.findByTestId('assistant-confirmed')).textContent).toMatch(/Saved as version 2/);
    });
});
