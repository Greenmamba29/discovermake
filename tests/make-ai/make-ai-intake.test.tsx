// @vitest-environment jsdom
/**
 * /make/ai UI: the "What do you want to make?" box posts only the text, then renders the
 * CreationIntent as cards with the "AI estimate — not a quote" label and the DXF quote CTA.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MakeAiIntakeResponse } from '@/contracts/make-ai';
import { MakeAiIntake } from '@/components/make-ai/make-ai-intake';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }));

const response: MakeAiIntakeResponse = {
    intentId: '01920000-0000-7000-8000-000000000001',
    model: 'gemini-test-flash',
    estimateOnly: true,
    intent: {
        intent: 'create',
        product_type: 'wall shelf bracket',
        summary: 'A bent mild-steel bracket for a wall shelf.',
        requirements: [
            { id: 'R1', text: 'Holds a 20 kg shelf', category: 'function', source: 'user', confidence: 0.9 },
            { id: 'R2', text: 'Indoor use', category: 'environment', source: 'inferred', confidence: 0.6 },
        ],
        constraints: [],
        unknowns: [
            { question: 'How deep is the shelf?', why_it_matters: 'Sets the bracket arm length.' },
            { question: 'How many brackets?', why_it_matters: 'Changes the unit price.', suggested_default: '2' },
        ],
        materials_suggested: [{ material: 'Mild steel (1008 cold rolled)', why: 'Strong and bends well.' }],
        processes_suggested: ['Fiber laser cutting', 'Press brake bending'],
        risk_class: 'elevated',
        required_specialists: [],
    },
};

const calls: { url: string; body: unknown }[] = [];

beforeEach(() => {
    calls.length = 0;
    nav.push.mockReset();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
            return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('MakeAiIntake', () => {
    it('validates an empty description client-side without calling the API', async () => {
        render(<MakeAiIntake />);
        fireEvent.click(screen.getByRole('button', { name: /plan it with make ai/i }));
        expect((await screen.findByRole('alert')).textContent).toMatch(/describe what you want to make/i);
        expect(calls).toHaveLength(0);
    });

    it('posts the text and renders the CreationIntent cards', async () => {
        render(<MakeAiIntake />);
        const box = screen.getByLabelText('What do you want to make?');
        fireEvent.change(box, { target: { value: 'A wall bracket for a 20 kg shelf' } });
        fireEvent.click(screen.getByRole('button', { name: /plan it with make ai/i }));

        const result = await screen.findByTestId('creation-intent');
        expect(calls).toEqual([{ url: '/api/make-ai/intake', body: { text: 'A wall bracket for a 20 kg shelf' } }]);
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Make AI plan' })));

        expect(within(result).getByText('AI estimate — not a quote')).toBeTruthy();
        expect(within(result).getByRole('heading', { name: 'wall shelf bracket' })).toBeTruthy();

        // Requirements checklist: buyer-stated ticked, inferred waiting for confirmation.
        const r1 = within(result).getByRole('checkbox', { name: /holds a 20 kg shelf/i }) as HTMLInputElement;
        const r2 = within(result).getByRole('checkbox', { name: /indoor use/i }) as HTMLInputElement;
        expect(r1.checked).toBe(true);
        expect(r2.checked).toBe(false);
        fireEvent.click(r2);
        expect(r2.checked).toBe(true);
        expect(within(result).getByText('2 of 2 confirmed')).toBeTruthy();

        // Unknowns as question cards, with a suggested default only where one exists.
        expect(within(result).getByText('How deep is the shelf?')).toBeTruthy();
        expect(within(result).getByText(/no safe default/i)).toBeTruthy();
        const useDefault = within(result).getByRole('button', { name: 'Use this default' });
        fireEvent.click(useDefault);
        expect(useDefault.getAttribute('aria-pressed')).toBe('true');

        expect(within(result).getByText('Mild steel (1008 cold rolled)')).toBeTruthy();
        expect(within(result).getByText('Press brake bending')).toBeTruthy();

        const cta = within(result).getByRole('link', { name: /have a dxf\? get an instant quote/i });
        expect(cta.getAttribute('href')).toBe('/make');
    });

    it('shows a refusal instead of guidance for out-of-scope requests', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        ...response,
                        intent: { ...response.intent, risk_class: 'regulated', refusal_note: 'DiscoverMake does not make weapon parts.', requirements: [], unknowns: [], materials_suggested: [], processes_suggested: [] },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            ),
        );
        render(<MakeAiIntake />);
        fireEvent.change(screen.getByLabelText('What do you want to make?'), { target: { value: 'something out of scope' } });
        fireEvent.click(screen.getByRole('button', { name: /plan it with make ai/i }));
        const result = await screen.findByTestId('creation-intent');
        expect(within(result).getByText('DiscoverMake does not make weapon parts.')).toBeTruthy();
        expect(within(result).queryByRole('checkbox')).toBeNull();
        expect(within(result).getByText('Out of scope')).toBeTruthy();
        // A refused plan can never become a build.
        expect(within(result).queryByRole('button', { name: /continue to build/i })).toBeNull();
    });

    it('"Continue to Build" creates the build from the intent and opens its workspace', async () => {
        render(<MakeAiIntake />);
        fireEvent.change(screen.getByLabelText('What do you want to make?'), { target: { value: 'A wall bracket for a 20 kg shelf' } });
        fireEvent.click(screen.getByRole('button', { name: /plan it with make ai/i }));
        const result = await screen.findByTestId('creation-intent');

        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
                return new Response(JSON.stringify({ buildId: 'bld_abc123', displayId: 'DM-7K3QX', created: true }), { status: 201, headers: { 'content-type': 'application/json' } });
            }),
        );
        fireEvent.click(within(result).getByRole('button', { name: /continue to build/i }));
        await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/build/bld_abc123/workspace'));
        expect(calls.at(-1)).toEqual({ url: '/api/make-ai/builds', body: { intentId: response.intentId } });
    });

    it('"Continue to Build" shows the server error and stays on the page', async () => {
        render(<MakeAiIntake />);
        fireEvent.change(screen.getByLabelText('What do you want to make?'), { target: { value: 'A wall bracket' } });
        fireEvent.click(screen.getByRole('button', { name: /plan it with make ai/i }));
        const result = await screen.findByTestId('creation-intent');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many Make AI requests. Wait a minute and try again.' } }), { status: 429 })));
        fireEvent.click(within(result).getByRole('button', { name: /continue to build/i }));
        expect((await within(result).findByRole('alert')).textContent).toMatch(/too many make ai requests/i);
        expect(nav.push).not.toHaveBeenCalled();
    });

    it('surfaces server errors (e.g. rate limit) in plain language', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many Make AI requests. Wait a minute and try again.' } }), { status: 429 })),
        );
        render(<MakeAiIntake />);
        fireEvent.change(screen.getByLabelText('What do you want to make?'), { target: { value: 'A bracket' } });
        fireEvent.click(screen.getByRole('button', { name: /plan it with make ai/i }));
        expect(await screen.findByText(/too many make ai requests/i)).toBeTruthy();
        expect(screen.queryByTestId('creation-intent')).toBeNull();
    });
});
