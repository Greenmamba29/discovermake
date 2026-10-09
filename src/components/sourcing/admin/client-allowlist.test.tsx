// @vitest-environment jsdom
/**
 * Accio clients panel: the per-workspace allowlist editor sends the tools and IP ranges with the
 * admin bearer token, stores "everything" as null, and validates CIDRs before calling the API.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowlistSummary, ClientAllowlistEditor } from './client-allowlist';

const CLIENT = { clientId: 'scl_abc', name: 'Accio Work', createdAt: '2026-10-09T00:00:00.000Z', lastUsedAt: null, revokedAt: null, allowedTools: null, allowedCidrs: null };
let calls: { method: string; url: string; auth: string | null; body: unknown }[];

beforeEach(() => {
    calls = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const body = init?.body ? JSON.parse(String(init.body)) : null;
            calls.push({ method: init?.method ?? 'GET', url: String(input), auth: ((init?.headers ?? {}) as Record<string, string>).authorization ?? null, body });
            return new Response(JSON.stringify({ ...CLIENT, ...body }), { status: 200, headers: { 'content-type': 'application/json' } });
        }),
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('ClientAllowlistEditor', () => {
    it('saves the selected tools and IP ranges with the admin token', async () => {
        const onSaved = vi.fn();
        render(<ClientAllowlistEditor token="good-token" client={CLIENT} onSaved={onSaved} onCancel={() => undefined} />);
        fireEvent.click(screen.getByTestId('allow-tool-submit_offer'));
        fireEvent.click(screen.getByTestId('allow-tool-attach_document'));
        fireEvent.change(screen.getByTestId('allow-cidrs'), { target: { value: '203.0.113.0/24\n2001:db8::/32' } });
        fireEvent.click(screen.getByTestId('client-allowlist-save'));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/admin/sourcing/clients/scl_abc/allowlist', auth: 'Bearer good-token' });
        expect(calls[0]!.body).toEqual({
            allowedTools: ['next_job', 'get_job', 'get_attachments', 'submit_supplier', 'update_negotiation', 'request_approval', 'complete_job'],
            allowedCidrs: ['203.0.113.0/24', '2001:db8::/32'],
        });
    });

    it('stores all tools and no IPs as null (unrestricted)', async () => {
        const onSaved = vi.fn();
        render(<ClientAllowlistEditor token="good-token" client={{ ...CLIENT, allowedTools: ['next_job'], allowedCidrs: ['198.51.100.0/24'] }} onSaved={onSaved} onCancel={() => undefined} />);
        for (const t of ['get_job', 'get_attachments', 'submit_supplier', 'submit_offer', 'update_negotiation', 'attach_document', 'request_approval', 'complete_job']) fireEvent.click(screen.getByTestId(`allow-tool-${t}`));
        fireEvent.change(screen.getByTestId('allow-cidrs'), { target: { value: '' } });
        fireEvent.click(screen.getByTestId('client-allowlist-save'));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(calls[0]!.body).toEqual({ allowedTools: null, allowedCidrs: null });
    });

    it('rejects an invalid range or an empty tool set without calling the API', async () => {
        render(<ClientAllowlistEditor token="good-token" client={CLIENT} onSaved={() => undefined} onCancel={() => undefined} />);
        fireEvent.change(screen.getByTestId('allow-cidrs'), { target: { value: 'office-network' } });
        fireEvent.click(screen.getByTestId('client-allowlist-save'));
        expect(await screen.findByText(/"office-network" is not an IP address/)).toBeTruthy();
        expect(calls).toHaveLength(0);
    });

    it('summarizes a client allowlist', () => {
        expect(allowlistSummary(CLIENT)).toBe('all tools · any IP');
        expect(allowlistSummary({ allowedTools: ['next_job', 'get_job'], allowedCidrs: ['203.0.113.0/24'] })).toBe('2 of 9 tools · 203.0.113.0/24');
    });
});
