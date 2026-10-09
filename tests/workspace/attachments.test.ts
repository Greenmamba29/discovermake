/**
 * Attachment tray routes (100-1) against a seeded throwaway database and an isolated local
 * storage dir: signed upload -> verify (size + magic bytes + sha256) -> list -> delete, the
 * outbox events, and "Use as a part" running a DXF through the R1 analyze flow.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BuildAttachmentList, BuildAttachmentView, CreateAttachmentResponse, MAX_IMAGE_ATTACHMENT_BYTES, UseAttachmentAsPartResponse } from '@/contracts/workspace';
import { buildAttachments, domainEvents, parts } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createBuildFromIntent } from '@/server/make-ai';
import { getStorage, LocalDiskStorage, setStorage } from '@/server/storage';
import { attachmentWriteLimiter } from '@/server/workspace/request';
import { GET as listRoute, POST as createRoute } from '@/app/api/builds/[buildId]/attachments/route';
import { DELETE as deleteRoute } from '@/app/api/builds/[buildId]/attachments/[attachmentId]/route';
import { POST as completeRoute } from '@/app/api/builds/[buildId]/attachments/[attachmentId]/complete/route';
import { POST as usePartRoute } from '@/app/api/builds/[buildId]/attachments/[attachmentId]/use-as-part/route';
import { PUT as putLocal } from '@/app/api/storage/local/[...key]/route';
import { BRACKET_INTENT, insertIntent } from '../build-graph/fixtures';
import { useTestDb as withTestDb } from '../support/db';
import { attachmentBytes, type FixtureKind } from './fixtures';

const BASE = 'http://localhost:3100';
const params = <P>(p: P) => ({ params: Promise.resolve(p) });
let ip = 0;
const json = (url: string, body?: unknown, method = 'POST') =>
    new Request(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${++ip % 250}`, cookie: 'dm_device=dmd_testdevice0000000000000000000000000001' }, body: body === undefined ? undefined : JSON.stringify(body) });

const ctx = withTestDb({ seed: true });
let storageDir = '';
let buildId = '';

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-attach-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: BASE, signingSecret: process.env.STORAGE_SIGNING_SECRET ?? 'test-storage-secret' }));
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    resetEnvCache();
    buildId = (await createBuildFromIntent(await insertIntent(ctx.db, BRACKET_INTENT))).buildId;
});
afterAll(async () => {
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
beforeEach(() => attachmentWriteLimiter.reset());

async function create(filename: string, contentType: string, sizeBytes: number) {
    return createRoute(json(`/api/builds/${buildId}/attachments`, { filename, contentType, sizeBytes }), params({ buildId }));
}

/** PUT bytes to the signed URL exactly as a browser would (through the local storage route). */
async function put(upload: CreateAttachmentResponse['upload'], bytes: Uint8Array, contentType = upload.headers['content-type']) {
    const url = new URL(upload.url);
    const key = url.pathname.replace('/api/storage/local/', '').split('/');
    return putLocal(new Request(upload.url, { method: 'PUT', headers: contentType ? { 'content-type': contentType } : {}, body: bytes.slice() }), params({ key }));
}

async function attach(kind: FixtureKind, filename: string, contentType: string) {
    const bytes = attachmentBytes(kind);
    const res = await create(filename, contentType, bytes.byteLength);
    expect(res.status).toBe(201);
    const created = CreateAttachmentResponse.parse(await res.json());
    expect((await put(created.upload, bytes)).status).toBe(200);
    const done = await completeRoute(json(`/api/builds/${buildId}/attachments/${created.attachment.id}/complete`), params({ buildId, attachmentId: created.attachment.id }));
    return { created, done, bytes };
}

describe('attachment upload', () => {
    it('signs an upload bound to the declared type, verifies the bytes and emits build.attachment_added', async () => {
        const bytes = attachmentBytes('png');
        const res = await create('../../etc/sketch.png', 'image/png', bytes.byteLength);
        expect(res.status).toBe(201);
        const created = CreateAttachmentResponse.parse(await res.json());
        expect(created.attachment).toMatchObject({ status: 'pending', sha256: null, url: null, kind: 'image', filename: 'sketch.png', designVersion: 1 });
        expect(created.upload.key).toBe(`builds/${buildId}/attachments/${created.attachment.id}/sketch.png`);
        expect(created.upload.maxBytes).toBe(MAX_IMAGE_ATTACHMENT_BYTES);

        // The signature is bound to image/png: another content type is refused by storage.
        expect((await put(created.upload, bytes, 'image/jpeg')).status).toBe(415);
        // Completing before the bytes exist is a conflict.
        const early = await completeRoute(json(`/api/builds/${buildId}/attachments/${created.attachment.id}/complete`), params({ buildId, attachmentId: created.attachment.id }));
        expect(early.status).toBe(409);

        expect((await put(created.upload, bytes)).status).toBe(200);
        const done = await completeRoute(json(`/api/builds/${buildId}/attachments/${created.attachment.id}/complete`), params({ buildId, attachmentId: created.attachment.id }));
        expect(done.status).toBe(200);
        const view = BuildAttachmentView.parse(await done.json());
        expect(view.status).toBe('ready');
        expect(view.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(view.thumbnailUrl).toContain(`/api/storage/local/builds/${buildId}/attachments/`);
        expect(view.url).toContain('fn=sketch.png');
        expect(view.usableAsPart).toBe(false);

        const [row] = await ctx.db.select().from(buildAttachments).where(eq(buildAttachments.id, view.id));
        expect(row!.deviceHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row!.deviceHash).not.toContain('testdevice');
        const events = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.buildId, buildId), eq(domainEvents.eventType, 'build.attachment_added')));
        expect(events.map((e) => (e.payload as { attachmentId: string }).attachmentId)).toContain(view.id);

        // Completing again is idempotent (no second event).
        const again = await completeRoute(json(`/api/builds/${buildId}/attachments/${view.id}/complete`), params({ buildId, attachmentId: view.id }));
        expect(again.status).toBe(200);
        const events2 = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.buildId, buildId), eq(domainEvents.eventType, 'build.attachment_added')));
        expect(events2.length).toBe(events.length);
    });

    it('refuses bad metadata before handing out an upload URL', async () => {
        expect((await create('setup.exe', 'application/octet-stream', 100)).status).toBe(415);
        expect((await create('photo.png', 'image/jpeg', 100)).status).toBe(415);
        expect((await create('photo.png', 'image/png', MAX_IMAGE_ATTACHMENT_BYTES + 1)).status).toBe(413);
        expect((await create('model.step', 'application/step', 60 * 1024 * 1024)).status).toBe(400);
        const missing = await createRoute(json('/api/builds/bld_missing/attachments', { filename: 'a.png', contentType: 'image/png', sizeBytes: 10 }), params({ buildId: 'bld_missing' }));
        expect(missing.status).toBe(404);
    });

    it('deletes a file whose bytes do not match its extension', async () => {
        const jpeg = attachmentBytes('jpg');
        const created = CreateAttachmentResponse.parse(await (await create('render.png', 'image/png', jpeg.byteLength)).json());
        expect((await put(created.upload, jpeg)).status).toBe(200);
        const done = await completeRoute(json(`/api/builds/${buildId}/attachments/${created.attachment.id}/complete`), params({ buildId, attachmentId: created.attachment.id }));
        expect(done.status).toBe(415);
        expect((await done.json()).error.message).toMatch(/not a PNG image/);
        const [row] = await ctx.db.select().from(buildAttachments).where(eq(buildAttachments.id, created.attachment.id));
        expect(row!.deletedAt).not.toBeNull();
        expect(await getStorage().headObject(created.upload.key)).toBeNull();
    });

    it('re-checks the stored size (S3 does not enforce the signed cap)', async () => {
        const created = CreateAttachmentResponse.parse(await (await create('huge.png', 'image/png', 1000)).json());
        const big = new Uint8Array(MAX_IMAGE_ATTACHMENT_BYTES + 1);
        big.set(attachmentBytes('png'));
        await getStorage().putObject(created.upload.key, big, { contentType: 'image/png' });
        const done = await completeRoute(json(`/api/builds/${buildId}/attachments/${created.attachment.id}/complete`), params({ buildId, attachmentId: created.attachment.id }));
        expect(done.status).toBe(413);
        expect(await getStorage().headObject(created.upload.key)).toBeNull();
    });
});

describe('attachment list and delete', () => {
    it('lists verified files only, then deletes one (soft) with its object', async () => {
        const step = await attach('step', 'enclosure.step', 'application/octet-stream');
        expect(step.done.status).toBe(200);
        const stepView = BuildAttachmentView.parse(await step.done.json());
        expect(stepView).toMatchObject({ kind: 'cad', thumbnailUrl: null, usableAsPart: false });
        // A pending (never uploaded) row is not listed.
        await create('pending.svg', 'image/svg+xml', 100);

        const listed = BuildAttachmentList.parse(await (await listRoute(json(`/api/builds/${buildId}/attachments`, undefined, 'GET'), params({ buildId }))).json());
        expect(listed.attachments.map((a) => a.filename)).toContain('enclosure.step');
        expect(listed.attachments.every((a) => a.status === 'ready')).toBe(true);
        expect(listed.attachments.some((a) => a.filename === 'pending.svg')).toBe(false);
        expect(listed.limits).toEqual({ imageBytes: 15 * 1024 * 1024, cadBytes: 50 * 1024 * 1024, perBuild: 40 });

        const del = await deleteRoute(json(`/api/builds/${buildId}/attachments/${stepView.id}`, undefined, 'DELETE'), params({ buildId, attachmentId: stepView.id }));
        expect(del.status).toBe(200);
        expect(await del.json()).toEqual({ ok: true });
        expect(await getStorage().headObject(step.created.upload.key)).toBeNull();
        const after = BuildAttachmentList.parse(await (await listRoute(json(`/api/builds/${buildId}/attachments`, undefined, 'GET'), params({ buildId }))).json());
        expect(after.attachments.some((a) => a.id === stepView.id)).toBe(false);
        const removed = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.buildId, buildId), eq(domainEvents.eventType, 'build.attachment_removed')));
        expect(removed.map((e) => (e.payload as { attachmentId: string }).attachmentId)).toContain(stepView.id);

        expect((await deleteRoute(json(`/api/builds/${buildId}/attachments/${stepView.id}`, undefined, 'DELETE'), params({ buildId, attachmentId: stepView.id }))).status).toBe(404);
        expect((await deleteRoute(json(`/api/builds/${buildId}/attachments/nope`, undefined, 'DELETE'), params({ buildId, attachmentId: 'nope' }))).status).toBe(404);
    });
});

describe('use as a part', () => {
    it('runs a DXF attachment through analyze and returns the same part on repeat', async () => {
        const dxf = await attach('dxf', 'mounting-plate.dxf', 'image/vnd.dxf');
        const view = BuildAttachmentView.parse(await dxf.done.json());
        expect(view.usableAsPart).toBe(true);

        const res = await usePartRoute(json(`/api/builds/${buildId}/attachments/${view.id}/use-as-part`), params({ buildId, attachmentId: view.id }));
        expect(res.status).toBe(201);
        const used = UseAttachmentAsPartResponse.parse(await res.json());
        expect(used.status).toBe('READY');
        expect(used.url).toBe(`/parts/${used.partId}`);
        const [part] = await ctx.db.select().from(parts).where(eq(parts.id, used.partId));
        expect(part).toMatchObject({ buildId, filename: 'mounting-plate.dxf', status: 'READY', units: 'mm' });
        expect(part!.features?.bboxWidthMm).toBeCloseTo(120, 3);

        const again = UseAttachmentAsPartResponse.parse(await (await usePartRoute(json(`/api/builds/${buildId}/attachments/${view.id}/use-as-part`), params({ buildId, attachmentId: view.id }))).json());
        expect(again.partId).toBe(used.partId);

        const svg = await attach('svg', 'outline.svg', 'image/svg+xml');
        const svgView = BuildAttachmentView.parse(await svg.done.json());
        expect((await usePartRoute(json(`/api/builds/${buildId}/attachments/${svgView.id}/use-as-part`), params({ buildId, attachmentId: svgView.id }))).status).toBe(415);

        // Binary DXF can be attached as a reference, but not quoted instantly.
        const bin = await attach('dxf-binary', 'binary.dxf', 'application/dxf');
        const binView = BuildAttachmentView.parse(await bin.done.json());
        const refused = await usePartRoute(json(`/api/builds/${buildId}/attachments/${binView.id}/use-as-part`), params({ buildId, attachmentId: binView.id }));
        expect(refused.status).toBe(415);
        expect((await refused.json()).error.message).toMatch(/ASCII DXF/);
    });
});
