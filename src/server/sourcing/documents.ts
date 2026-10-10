/**
 * Documents the agent brings back from suppliers (quotes, drawings, certificates,
 * sample photos, invoices). The base64 body is decoded strictly, capped at 5 MB, its
 * magic bytes must match the declared content type, and it is stored under
 * `sourcing/<jobId>/documents/...` with its sha256. Emits `sourcing.document_attached`.
 */
import { eq } from 'drizzle-orm';
import { actorId } from '../../contracts/common';
import type { AttachDocumentInput } from '../../contracts/sourcing';
import { sha256Hex } from '../auth/tokens';
import { withTx } from '../db';
import { sourcingDocuments, suppliers } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { newId } from '../ids';
import { getStorage } from '../storage';
import { enforceBoundary } from './boundary';
import { MAX_DOCUMENT_BYTES } from './constants';
import { invalid, notFound } from './errors';
import { getJobRow, lockJobForWrite, writerActor, type JobWriter } from './jobs';
import type { DocumentRow } from './views';

export type AttachDocumentArgs = Omit<AttachDocumentInput, 'lease_id'>;
export type DocumentContentType = AttachDocumentInput['content_type'];

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strict base64 decode (whitespace ignored). Throws VALIDATION_FAILED on anything else or over the cap. */
export function decodeBase64Document(b64: string, maxBytes: number = MAX_DOCUMENT_BYTES): Buffer {
    const clean = b64.replace(/\s+/g, '');
    if (!clean.length || clean.length % 4 !== 0 || !BASE64_RE.test(clean)) throw invalid('content_base64 is not valid base64');
    // 4 base64 chars -> 3 bytes; check before allocating.
    const approx = (clean.length / 4) * 3 - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
    if (approx > maxBytes) throw invalid(`Document exceeds ${maxBytes} bytes`);
    const bytes = Buffer.from(clean, 'base64');
    if (!bytes.length) throw invalid('Document is empty');
    return bytes;
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function looksBinary(b: Uint8Array): boolean {
    return (
        startsWith(b, ascii('%PDF-')) ||
        startsWith(b, [0x89, 0x50, 0x4e, 0x47]) ||
        startsWith(b, [0xff, 0xd8, 0xff]) ||
        startsWith(b, ascii('RIFF')) ||
        startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || // zip / office docs
        startsWith(b, ascii('MZ')) || // windows executables
        startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) // ELF
    );
}

/** True when the bytes really are `contentType` (magic bytes; text must be NUL-free UTF-8). */
export function matchesContentType(bytes: Uint8Array, contentType: DocumentContentType): boolean {
    switch (contentType) {
        case 'application/pdf':
            return startsWith(bytes, ascii('%PDF-'));
        case 'image/png':
            return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        case 'image/jpeg':
            return startsWith(bytes, [0xff, 0xd8, 0xff]);
        case 'image/webp':
            return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8);
        case 'text/plain':
        case 'text/csv': {
            if (looksBinary(bytes) || bytes.includes(0)) return false;
            try {
                new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                return true;
            } catch {
                return false;
            }
        }
        default: {
            const never: never = contentType;
            throw new Error(`Unknown content type ${String(never)}`);
        }
    }
}

/** Storage-safe file name (keys allow [A-Za-z0-9/_.-] only). */
export function safeFilename(name: string): string {
    const cleaned = name
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/\.{2,}/g, '.')
        .replace(/^[._-]+/, '')
        .slice(0, 100);
    return cleaned || 'document';
}

export const sourcingDocumentKey = (jobId: string, documentId: string, filename: string) => `sourcing/${jobId}/documents/${documentId}-${safeFilename(filename)}`;

export async function attachDocument(input: AttachDocumentArgs, writer: JobWriter, opts: { now?: Date } = {}): Promise<DocumentRow> {
    const now = opts.now ?? new Date();
    const actor = writerActor(writer);
    const bytes = decodeBase64Document(input.content_base64);
    if (!matchesContentType(bytes, input.content_type)) throw invalid(`The file's contents do not match content_type ${input.content_type}`);
    const preview = await getJobRow(input.sourcing_request_id);
    if (!preview) throw notFound('Sourcing job');
    await enforceBoundary('attach_document', { job: preview, actor, tool: 'attach_document', supplierId: input.supplier_id ?? null });

    return withTx(async (tx) => {
        const job = await lockJobForWrite(tx, input.sourcing_request_id, writer, { now });
        if (input.supplier_id) {
            const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplier_id));
            if (!s) throw notFound('Supplier');
        }
        const id = newId('sourcingDocument');
        const fileKey = sourcingDocumentKey(job.id, id, input.filename);
        const sha256 = sha256Hex(bytes);
        // Stored inside the transaction: if the upload fails, no row points at a missing object.
        await getStorage().putObject(fileKey, bytes, { contentType: input.content_type });
        const [row] = await tx
            .insert(sourcingDocuments)
            .values({
                id,
                jobId: job.id,
                supplierId: input.supplier_id ?? null,
                kind: input.kind,
                fileKey,
                filename: input.filename,
                contentType: input.content_type,
                sizeBytes: bytes.length,
                sha256,
                uploadedBy: actorId(actor),
                createdAt: now,
            })
            .returning();
        await emitEvent(tx, {
            type: 'sourcing.document_attached',
            payload: { jobId: job.id, documentId: id, kind: input.kind },
            actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
        return row;
    });
}
