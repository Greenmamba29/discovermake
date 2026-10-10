// @vitest-environment jsdom
/**
 * Attachment tray: thumbnails vs file-type icons, upload (create -> signed PUT with progress ->
 * complete), client-side pre-checks, remove, and "Use as a part" for DXF files.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildAttachmentView } from '@/contracts/workspace';
import { AttachmentTray, precheckFile } from './attachment-tray';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }));

const BUILD = 'bld_tray0001';
const T = '2026-10-09T12:00:00.000Z';
const att = (over: Partial<BuildAttachmentView>): BuildAttachmentView => ({
    id: 'att_a',
    buildId: BUILD,
    designVersion: 2,
    kind: 'image',
    filename: 'sketch.png',
    contentType: 'image/png',
    sizeBytes: 2048,
    sha256: 'a'.repeat(64),
    status: 'ready',
    url: 'http://localhost/api/storage/local/x?fn=sketch.png',
    thumbnailUrl: 'http://localhost/api/storage/local/x',
    usableAsPart: false,
    partId: null,
    createdAt: T,
    ...over,
});

let listed: BuildAttachmentView[];
let calls: { method: string; url: string; body: unknown }[];
let xhrSent: { url: string; headers: Record<string, string> }[];

class FakeXhr {
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    private url = '';
    private headers: Record<string, string> = {};
    open(_m: string, url: string) {
        this.url = url;
    }
    setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
    }
    send() {
        xhrSent.push({ url: this.url, headers: this.headers });
        setTimeout(() => {
            this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
            this.status = 200;
            this.onload?.();
        }, 0);
    }
    abort() {}
}

beforeEach(() => {
    listed = [att({}), att({ id: 'att_dxf', kind: 'cad', filename: 'plate.dxf', contentType: 'application/dxf', thumbnailUrl: null, usableAsPart: true }), att({ id: 'att_heic', filename: 'photo.heic', contentType: 'image/heic', thumbnailUrl: null })];
    calls = [];
    xhrSent = [];
    nav.push.mockReset();
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ method, url, body });
            const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
            const limits = { imageBytes: 15 * 1024 * 1024, cadBytes: 50 * 1024 * 1024, perBuild: 40 };
            if (method === 'GET' && url.endsWith('/attachments')) return ok({ attachments: listed, limits });
            if (method === 'POST' && url.endsWith('/attachments')) {
                return ok(
                    {
                        attachment: att({ id: 'att_new', filename: body.filename, status: 'pending', sha256: null, url: null, thumbnailUrl: null }),
                        upload: { url: 'http://localhost/api/storage/local/builds/x/attachments/att_new/new.png?sig=1', method: 'PUT', headers: { 'content-type': body.contentType }, key: 'builds/x', expiresAt: T, maxBytes: 15 * 1024 * 1024 },
                    },
                    201,
                );
            }
            if (method === 'POST' && url.endsWith('/complete')) {
                listed = [...listed, att({ id: 'att_new', filename: 'new.png' })];
                return ok(att({ id: 'att_new', filename: 'new.png' }));
            }
            if (method === 'DELETE') {
                listed = listed.filter((a) => !url.endsWith(a.id));
                return ok({ ok: true });
            }
            if (method === 'POST' && url.endsWith('/use-as-part')) return ok({ partId: 'prt_fromdxf', status: 'READY', url: '/parts/prt_fromdxf' }, 201);
            return ok({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
        }),
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderTray() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AttachmentTray buildId={BUILD} />
        </QueryClientProvider>,
    );
}

describe('precheckFile', () => {
    it('applies the same extension and size rules as the server', () => {
        expect(precheckFile({ name: 'a.png', size: 10 })).toBeNull();
        expect(precheckFile({ name: 'a.exe', size: 10 })).toMatch(/cannot be attached/);
        expect(precheckFile({ name: 'a.jpg', size: 16 * 1024 * 1024 })).toMatch(/up to 15\.0 MB/);
        expect(precheckFile({ name: 'a.step', size: 49 * 1024 * 1024 })).toBeNull();
        expect(precheckFile({ name: 'a.stl', size: 0 })).toMatch(/empty/);
    });
});

describe('AttachmentTray', () => {
    it('shows thumbnails for browser images and type icons otherwise', async () => {
        renderTray();
        const list = await screen.findByTestId('attachment-list');
        expect(within(list).getAllByTestId('attachment-thumbnail')).toHaveLength(1);
        expect(within(list).getByAltText('Preview of sketch.png')).toBeTruthy();
        expect(within(screen.getByTestId('attachment-att_heic')).getByText('heic')).toBeTruthy();
        expect(within(screen.getByTestId('attachment-att_dxf')).getByText('dxf')).toBeTruthy();
        // Only the DXF offers "Use as a part".
        expect(screen.getAllByTestId('attachment-use-as-part')).toHaveLength(1);
        expect(within(screen.getByTestId('attachment-att_dxf')).getByTestId('attachment-use-as-part')).toBeTruthy();
    });

    it('uploads through create -> signed PUT -> complete and refreshes the list', async () => {
        renderTray();
        await screen.findByTestId('attachment-list');
        const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'new.png', { type: 'image/png' });
        await act(async () => {
            fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [file] } });
        });
        await waitFor(() => expect(screen.getByTestId(`attachment-att_new`)).toBeTruthy());
        const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/attachments'))!;
        expect(create.body).toEqual({ filename: 'new.png', contentType: 'image/png', sizeBytes: 4 });
        expect(xhrSent).toHaveLength(1);
        expect(xhrSent[0]!.headers['content-type']).toBe('image/png');
        expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/attachments/att_new/complete'))).toBe(true);
        expect(screen.queryByTestId('attachment-upload')).toBeNull();
    });

    it('infers a content type for CAD files the browser leaves untyped, and blocks bad files locally', async () => {
        renderTray();
        await screen.findByTestId('attachment-list');
        const step = new File(['ISO-10303-21;'], 'body.step', { type: '' });
        const exe = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });
        await act(async () => {
            fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [step, exe] } });
        });
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/attachments'))).toHaveLength(1));
        expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/attachments'))!.body).toMatchObject({ filename: 'body.step', contentType: 'application/step' });
        expect((await screen.findByRole('alert')).textContent).toMatch(/tool\.exe: \.exe files cannot be attached/);
    });

    it('removes a file and runs a DXF through the instant quote', async () => {
        renderTray();
        await screen.findByTestId('attachment-list');
        fireEvent.click(within(screen.getByTestId('attachment-att_a')).getByTestId('attachment-remove'));
        await waitFor(() => expect(screen.queryByTestId('attachment-att_a')).toBeNull());
        expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/attachments/att_a'))).toBe(true);
        expect(screen.getByRole('status').textContent).toBe('sketch.png removed.');

        fireEvent.click(screen.getByTestId('attachment-use-as-part'));
        await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/parts/prt_fromdxf'));
    });
});
