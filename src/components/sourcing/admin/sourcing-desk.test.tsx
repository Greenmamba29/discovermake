// @vitest-environment jsdom
/**
 * Sourcing desk: admin token gate, job queue filters, the approvals inbox and Accio clients
 * (token shown once, then revocable). Every admin call carries the bearer token.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalView } from '@/contracts';
import { approvalView, sourcingJobView } from '../../__fixtures__/contracts';
import { ADMIN_TOKEN_KEY } from './admin-gate';
import { SourcingDesk } from './sourcing-desk';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/admin/sourcing' }));

type Call = { method: string; url: string; auth: string | null; body: unknown };
let calls: Call[];
let approvals: ApprovalView[];

beforeEach(() => {
    calls = [];
    approvals = [approvalView()];
    window.sessionStorage.clear();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            const headers = (init?.headers ?? {}) as Record<string, string>;
            const auth = headers.authorization ?? null;
            calls.push({ method, url, auth, body: init?.body ? JSON.parse(String(init.body)) : null });
            const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (auth !== 'Bearer good-token') return ok({ error: { code: 'UNAUTHORIZED', message: 'bad token' } }, 401);
            if (url.startsWith('/api/admin/sourcing/approvals?status=PENDING')) return ok(approvals.filter((a) => a.status === 'PENDING'));
            const decision = url.match(/\/api\/admin\/sourcing\/approvals\/([^/]+)\/decision$/);
            if (decision) {
                const body = JSON.parse(String(init!.body));
                approvals = approvals.map((a) => (a.id === decision[1] ? { ...a, status: body.decision, decisionNote: body.note ?? null } : a));
                return ok(approvals.find((a) => a.id === decision[1]));
            }
            if (url.startsWith('/api/admin/sourcing/jobs')) {
                const status = new URL(url, 'http://x').searchParams.get('status');
                const jobs = [sourcingJobView(), sourcingJobView({ id: 'src_job2', displayId: 'SRC-9QQQQ', status: 'QUEUED', pendingApprovalCount: 0 })];
                return ok(status ? jobs.filter((j) => j.status === status) : jobs);
            }
            if (url === '/api/admin/sourcing/clients' && method === 'POST') return ok({ clientId: 'scl_new', name: 'Accio Work · metal', token: 'dmsrc_secret_123' }, 201);
            if (url === '/api/admin/sourcing/clients/scl_new' && method === 'DELETE') return ok({ ok: true });
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderDesk() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <SourcingDesk />
        </QueryClientProvider>,
    );
}

async function signIn(token = 'good-token') {
    fireEvent.change(await screen.findByTestId('sourcing-admin-token-input'), { target: { value: token } });
    await act(async () => {
        fireEvent.click(screen.getByTestId('sourcing-admin-login-submit'));
    });
}

describe('SourcingDesk', () => {
    it('rejects a bad token and keeps the good one in this tab only', async () => {
        renderDesk();
        await signIn('nope');
        expect((await screen.findByRole('alert')).textContent).toContain('not accepted');
        await signIn();
        await screen.findByTestId('sourcing-job-list');
        expect(window.sessionStorage.getItem(ADMIN_TOKEN_KEY)).toBe('good-token');
    });

    it('filters the job queue by status', async () => {
        window.sessionStorage.setItem(ADMIN_TOKEN_KEY, 'good-token');
        renderDesk();
        const list = await screen.findByTestId('sourcing-job-list');
        expect(within(list).getAllByRole('link')).toHaveLength(2);
        expect(screen.getByTestId('sourcing-job-SRC-7K3QX').getAttribute('href')).toBe('/admin/sourcing/jobs/src_job1');
        expect(screen.getByTestId('sourcing-job-SRC-7K3QX').textContent).toContain('1 approval pending');

        fireEvent.click(screen.getByTestId('sourcing-filter-QUEUED'));
        await waitFor(() => expect(within(screen.getByTestId('sourcing-job-list')).getAllByRole('link')).toHaveLength(1));
        expect(calls.some((c) => c.url === '/api/admin/sourcing/jobs?status=QUEUED')).toBe(true);
        expect(calls.filter((c) => c.url.startsWith('/api/admin')).every((c) => c.auth === 'Bearer good-token')).toBe(true);
    });

    it('decides pending approvals from the inbox with a note', async () => {
        window.sessionStorage.setItem(ADMIN_TOKEN_KEY, 'good-token');
        renderDesk();
        const tab = await screen.findByTestId('desk-tab-approvals');
        await waitFor(() => expect(tab.textContent).toContain('1'));
        fireEvent.click(tab);
        const card = await screen.findByTestId('approval-apr_1');
        expect(card.textContent).toContain('Release full design package');
        expect(card.textContent).toContain('Supplier needs the full drawing');
        fireEvent.change(within(card).getByTestId('approval-note-apr_1'), { target: { value: 'NDA on file' } });
        fireEvent.click(within(card).getByTestId('approve-apr_1'));
        await act(async () => {
            fireEvent.click(within(card).getByTestId('approve-apr_1-confirm'));
        });
        const decided = calls.find((c) => c.url.endsWith('/approvals/apr_1/decision'));
        expect(decided?.body).toEqual({ decision: 'APPROVED', note: 'NDA on file' });
        expect(await screen.findByText('Inbox zero')).toBeTruthy();
    });

    it('keyboard moves between desk tabs', async () => {
        window.sessionStorage.setItem(ADMIN_TOKEN_KEY, 'good-token');
        renderDesk();
        const queue = await screen.findByTestId('desk-tab-queue');
        fireEvent.keyDown(queue, { key: 'ArrowRight' });
        expect(screen.getByTestId('desk-tab-approvals').getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(screen.getByTestId('desk-tab-approvals'));
        fireEvent.keyDown(screen.getByTestId('desk-tab-approvals'), { key: 'End' });
        expect(screen.getByTestId('desk-tab-clients').getAttribute('aria-selected')).toBe('true');
    });

    it('creates an Accio client, shows its token once with a copy button, and revokes it', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        window.sessionStorage.setItem(ADMIN_TOKEN_KEY, 'good-token');
        renderDesk();
        fireEvent.click(await screen.findByTestId('desk-tab-clients'));
        fireEvent.change(screen.getByTestId('client-name-input'), { target: { value: 'Accio Work · metal' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('client-create'));
        });
        const once = await screen.findByTestId('client-token-once');
        expect(within(once).getByTestId('client-token').textContent).toBe('dmsrc_secret_123');
        expect(once.textContent).toContain('shown once');
        await act(async () => {
            fireEvent.click(within(once).getByTestId('client-token-copy'));
        });
        expect(writeText).toHaveBeenCalledWith('dmsrc_secret_123');
        expect(within(once).getByTestId('client-token-copy').textContent).toContain('Copied');

        fireEvent.click(screen.getByTestId('client-revoke-scl_new'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('client-revoke-scl_new-confirm'));
        });
        expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/admin/sourcing/clients/scl_new')).toBe(true);
        expect(screen.queryByTestId('client-token-once')).toBeNull();
        expect(screen.getByText(/revoked\. Its token stops working/)).toBeTruthy();
    });
});
