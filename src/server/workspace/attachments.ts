/**
 * Build attachments (100-1): reference images and CAD files on a build.
 *
 *   createAttachmentUpload(build, input, ctx)  row (sha256 null) + signed PUT URL (size + type bound)
 *   completeAttachment(buildId, id)            size + magic bytes + sha256; emits build.attachment_added
 *   listAttachments(buildId)                   verified, not deleted, with fresh signed URLs
 *   deleteAttachment(buildId, id)              soft delete + storage delete; emits build.attachment_removed
 *   useAttachmentAsPart(buildId, id)           DXF -> part on the same build -> R1 analyze (instant quote)
 *
 * Storage: `builds/<buildId>/attachments/<attId>/<safe filename>`. The signed PUT binds the
 * declared content type and (local driver) the size cap; S3 does not enforce the cap, so
 * completion re-checks the stored object's size and bytes before anything trusts it.
 */
import 'server-only';
import { scanUpload } from '@/server/security/upload-scan';
import { createHash } from 'node:crypto';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Actor } from '@/contracts';
import {
    attachmentExtension,
    maxBytesFor,
    MAX_ATTACHMENTS_PER_BUILD,
    MAX_CAD_ATTACHMENT_BYTES,
    MAX_IMAGE_ATTACHMENT_BYTES,
    type BuildAttachmentList,
    type BuildAttachmentView,
    type CreateAttachmentRequest,
    type CreateAttachmentResponse,
    type UseAttachmentAsPartResponse,
} from '@/contracts/workspace';
import { guestActor, loadBuild, type BuildRow } from '@/server/build-graph';
import { getDb, withTx } from '@/server/db';
import { buildAttachments, parts } from '@/server/db/schema';
import { emitEvent } from '@/server/events/outbox';
import { ApiError } from '@/server/http';
import { newId } from '@/server/ids';
import { analyzePart, uploadPartBytes, UnsupportedFileError } from '@/server/quote';
import { sniffDxf } from '@/server/quote/dxf/sniff';
import { assertValidKey, getStorage, storageKeys } from '@/server/storage';
import { attachmentStorageKey, sniffAttachment, THUMBNAIL_EXTENSIONS, validateAttachmentRequest } from './attachment-files';

export const ATTACHMENT_UPLOAD_TTL_SECONDS = 30 * 60;
export const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;

type AttachmentRow = typeof buildAttachments.$inferSelect;

export type AttachmentContext = { actor?: Actor; deviceHash?: string | null; userId?: string | null };

/** The build, or 404. Routes pass it to `assertCanEditBuild` before any write. */
export async function requireBuild(buildId: string): Promise<BuildRow> {
    const build = await loadBuild(getDb(), buildId);
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    return build;
}

async function signedUrls(row: AttachmentRow): Promise<{ url: string | null; thumbnailUrl: string | null }> {
    if (!row.sha256) return { url: null, thumbnailUrl: null };
    const storage = getStorage();
    const safeName = row.storageKey.split('/').pop()!;
    const ext = attachmentExtension(safeName);
    // Downloads are always served as attachments (never rendered on our origin).
    const download = await storage.getSignedUrl(row.storageKey, { method: 'GET', expiresInSeconds: ATTACHMENT_URL_TTL_SECONDS, downloadFilename: safeName });
    const thumb = THUMBNAIL_EXTENSIONS.has(ext) ? await storage.getSignedUrl(row.storageKey, { method: 'GET', expiresInSeconds: ATTACHMENT_URL_TTL_SECONDS }) : null;
    return { url: download.url, thumbnailUrl: thumb?.url ?? null };
}

export async function toAttachmentView(row: AttachmentRow): Promise<BuildAttachmentView> {
    const ext = attachmentExtension(row.storageKey);
    return {
        id: row.id,
        buildId: row.buildId,
        designVersion: row.designVersion,
        kind: row.kind,
        filename: row.filename,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        status: row.sha256 ? 'ready' : 'pending',
        ...(await signedUrls(row)),
        usableAsPart: Boolean(row.sha256) && ext === 'dxf',
        partId: row.partId,
        createdAt: row.createdAt.toISOString(),
    };
}

async function loadAttachment(buildId: string, attachmentId: string): Promise<AttachmentRow> {
    const [row] = await getDb()
        .select()
        .from(buildAttachments)
        .where(and(eq(buildAttachments.id, attachmentId), eq(buildAttachments.buildId, buildId), isNull(buildAttachments.deletedAt)));
    if (!row) throw new ApiError('NOT_FOUND', 'Attachment not found');
    return row;
}

export async function createAttachmentUpload(build: BuildRow, input: CreateAttachmentRequest, ctx: AttachmentContext = {}): Promise<CreateAttachmentResponse> {
    const checked = validateAttachmentRequest(input);
    const db = getDb();
    const [{ n }] = await db
        .select({ n: count() })
        .from(buildAttachments)
        .where(and(eq(buildAttachments.buildId, build.id), isNull(buildAttachments.deletedAt)));
    if (Number(n) >= MAX_ATTACHMENTS_PER_BUILD) throw new ApiError('CONFLICT', `A build can hold up to ${MAX_ATTACHMENTS_PER_BUILD} files. Remove one first.`);

    const id = newId('buildAttachment');
    const key = attachmentStorageKey(build.id, id, checked.safeName);
    assertValidKey(key);
    const [row] = await db
        .insert(buildAttachments)
        .values({
            id,
            buildId: build.id,
            designVersion: build.currentVersion,
            kind: checked.kind,
            filename: checked.filename,
            contentType: checked.contentType,
            sizeBytes: input.sizeBytes,
            storageKey: key,
            createdByUserId: ctx.userId ?? null,
            deviceHash: ctx.deviceHash ?? null,
        })
        .returning();
    const signed = await getStorage().getSignedUrl(key, { method: 'PUT', contentType: checked.contentType, maxBytes: checked.maxBytes, expiresInSeconds: ATTACHMENT_UPLOAD_TTL_SECONDS });
    return {
        attachment: await toAttachmentView(row!),
        upload: { url: signed.url, method: 'PUT', headers: signed.headers, key, expiresAt: signed.expiresAt.toISOString(), maxBytes: checked.maxBytes },
    };
}

async function reject(row: AttachmentRow, error: ApiError): Promise<never> {
    await getDb().update(buildAttachments).set({ deletedAt: new Date() }).where(eq(buildAttachments.id, row.id));
    await getStorage()
        .deleteObject(row.storageKey)
        .catch(() => undefined);
    throw error;
}

/**
 * Verify an uploaded attachment: the object exists, is within the cap, and its bytes match its
 * extension. Records sha256 and emits `build.attachment_added`. Idempotent once verified.
 * A file that fails is deleted (row soft-deleted, object removed): the buyer attaches it again.
 */
export async function completeAttachment(buildId: string, attachmentId: string, ctx: AttachmentContext = {}): Promise<BuildAttachmentView> {
    const row = await loadAttachment(buildId, attachmentId);
    if (row.sha256) return toAttachmentView(row);
    const storage = getStorage();
    const max = maxBytesFor(row.kind);
    const head = await storage.headObject(row.storageKey);
    if (!head) throw new ApiError('CONFLICT', 'The file has not been uploaded yet. Send it to the upload URL first.');
    const tooLarge = () => new ApiError('PAYLOAD_TOO_LARGE', `${row.kind === 'image' ? 'Images' : 'CAD files'} can be up to ${max / 1024 / 1024} MB.`, 413);
    if (head.sizeBytes > max) return reject(row, tooLarge());
    const buf = await storage.getObject(row.storageKey);
    if (!buf) throw new ApiError('CONFLICT', 'The file has not been uploaded yet. Send it to the upload URL first.');
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength > max) return reject(row, tooLarge());
    const sniff = sniffAttachment(bytes, attachmentExtension(row.storageKey));
    if (!sniff.ok) return reject(row, new ApiError('UNSUPPORTED_MEDIA_TYPE', sniff.reason, 415, { reason: 'MAGIC_BYTES' }));
    try {
        await scanUpload(bytes, { filename: row.filename });
    } catch (err) {
        if (err instanceof ApiError && err.status === 422) return reject(row, err);
        throw err;
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const actor = ctx.actor ?? guestActor(buildId);
    const updated = await withTx(async (tx) => {
        const [u] = await tx
            .update(buildAttachments)
            .set({ sha256, sizeBytes: bytes.byteLength })
            .where(and(eq(buildAttachments.id, row.id), isNull(buildAttachments.sha256), isNull(buildAttachments.deletedAt)))
            .returning();
        if (!u) return null;
        await emitEvent(tx, {
            type: 'build.attachment_added',
            payload: { buildId, attachmentId: u.id, designVersion: u.designVersion, kind: u.kind, contentType: u.contentType, sizeBytes: u.sizeBytes, sha256 },
            actor,
            correlationId: buildId,
            buildId,
        });
        return u;
    });
    return toAttachmentView(updated ?? (await loadAttachment(buildId, attachmentId)));
}

export async function listAttachments(buildId: string): Promise<BuildAttachmentList> {
    const rows = await getDb()
        .select()
        .from(buildAttachments)
        .where(and(eq(buildAttachments.buildId, buildId), isNull(buildAttachments.deletedAt)))
        .orderBy(asc(buildAttachments.createdAt), asc(buildAttachments.id));
    const ready = rows.filter((r) => r.sha256);
    return {
        attachments: await Promise.all(ready.map(toAttachmentView)),
        limits: { imageBytes: MAX_IMAGE_ATTACHMENT_BYTES, cadBytes: MAX_CAD_ATTACHMENT_BYTES, perBuild: MAX_ATTACHMENTS_PER_BUILD },
    };
}

export async function deleteAttachment(buildId: string, attachmentId: string, ctx: AttachmentContext = {}): Promise<void> {
    const row = await loadAttachment(buildId, attachmentId);
    const actor = ctx.actor ?? guestActor(buildId);
    const removed = await withTx(async (tx) => {
        const [u] = await tx
            .update(buildAttachments)
            .set({ deletedAt: new Date() })
            .where(and(eq(buildAttachments.id, row.id), isNull(buildAttachments.deletedAt)))
            .returning({ id: buildAttachments.id, sha256: buildAttachments.sha256 });
        if (u?.sha256) await emitEvent(tx, { type: 'build.attachment_removed', payload: { buildId, attachmentId: u.id }, actor, correlationId: buildId, buildId });
        return Boolean(u);
    });
    if (!removed) throw new ApiError('NOT_FOUND', 'Attachment not found');
    // A part made from this file keeps its own copy (parts/<partId>/...), so the object can go.
    await getStorage()
        .deleteObject(row.storageKey)
        .catch(() => undefined);
}

/**
 * "Use as a part": run a DXF attachment through the R1 analyze -> instant quote flow. The bytes
 * are copied into a new part on the same build (exactly like a CAD-generated flat pattern), so
 * the configurator on /parts/:partId prices it. Runs once per attachment; later calls return
 * the same part.
 */
export async function useAttachmentAsPart(buildId: string, attachmentId: string): Promise<UseAttachmentAsPartResponse> {
    const db = getDb();
    const row = await loadAttachment(buildId, attachmentId);
    if (!row.sha256) throw new ApiError('CONFLICT', 'This file is still uploading.');
    if (attachmentExtension(row.storageKey) !== 'dxf') throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Only DXF flat patterns can be quoted instantly. Other files stay as references for the build.', 415);
    if (row.partId) {
        const [existing] = await db.select({ status: parts.status }).from(parts).where(eq(parts.id, row.partId));
        if (existing) return { partId: row.partId, status: existing.status, url: `/parts/${row.partId}` };
    }

    const buf = await getStorage().getObject(row.storageKey);
    if (!buf) throw new ApiError('CONFLICT', 'The file is missing from storage. Attach it again.');
    const bytes = new Uint8Array(buf);
    try {
        sniffDxf(bytes);
    } catch (err) {
        if (err instanceof UnsupportedFileError) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', err.message, 415, { reason: err.reason });
        throw err;
    }

    const build = await requireBuild(buildId);
    const partId = newId('part');
    await db.insert(parts).values({
        id: partId,
        buildId,
        designVersion: build.currentVersion,
        fileKey: storageKeys.partSource(partId),
        filename: row.filename,
        format: 'dxf',
        sizeBytes: bytes.byteLength,
        status: 'AWAITING_UPLOAD',
    });
    // Claim the attachment for this part; a concurrent click that lost the race drops its part.
    const [claimed] = await db
        .update(buildAttachments)
        .set({ partId })
        .where(and(eq(buildAttachments.id, row.id), isNull(buildAttachments.partId)))
        .returning({ id: buildAttachments.id });
    if (!claimed) {
        await db.delete(parts).where(eq(parts.id, partId));
        const again = await loadAttachment(buildId, attachmentId);
        return { partId: again.partId!, status: 'ANALYZING', url: `/parts/${again.partId}` };
    }
    await uploadPartBytes(partId, bytes);
    const part = await analyzePart(partId);
    return { partId, status: part.status, url: `/parts/${partId}` };
}
