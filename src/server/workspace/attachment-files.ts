/**
 * Pure attachment checks (100-1): filename sanitising, extension/content-type matching, size caps
 * and magic-byte sniffing. No database, no storage: unit-tested directly.
 *
 * Every upload is checked twice: the declared metadata when the signed upload URL is created
 * (`validateAttachmentRequest`), and the actual bytes when the upload is completed
 * (`sniffAttachment`). A file whose bytes do not match its extension is refused, never stored.
 */
import { ApiError } from '../http';
import {
    ATTACHMENT_FORMATS,
    attachmentExtension,
    maxBytesFor,
    MAX_ATTACHMENT_FILENAME_CHARS,
    type AttachmentKind,
    type CreateAttachmentRequest,
} from '../../contracts/workspace';

const SAFE_STEM_MAX = 80;

/** Last path segment only, without control characters (what the buyer sees in the tray). */
export function displayFilename(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? '';
    // eslint-disable-next-line no-control-regex
    const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return clean.slice(-MAX_ATTACHMENT_FILENAME_CHARS) || 'file';
}

/**
 * A storage-safe filename: ASCII letters, digits, `.`, `_` and `-`, starting with a letter or
 * digit, no `..`, extension kept. Path segments (`../`, `..\`) and anything else are dropped,
 * so the result can only ever name a file inside the attachment's own folder.
 */
export function safeAttachmentFilename(name: string): string {
    const base = displayFilename(name);
    const ext = attachmentExtension(base);
    const stemRaw = ext ? base.slice(0, base.length - ext.length - 1) : base;
    const stem = stemRaw
        .normalize('NFKD')
        .replace(/[^\x20-\x7e]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/\.{2,}/g, '.')
        .replace(/-{2,}/g, '-')
        .replace(/^[^A-Za-z0-9]+/, '')
        .replace(/[^A-Za-z0-9]+$/, '')
        .slice(0, SAFE_STEM_MAX);
    const safeStem = /[A-Za-z0-9]/.test(stem) ? stem : 'file';
    return ext ? `${safeStem}.${ext}` : safeStem;
}

export type ValidatedAttachment = { ext: string; kind: AttachmentKind; contentType: string; filename: string; safeName: string; maxBytes: number };

const ACCEPTED_COPY = 'Attach PNG, JPG, WebP or HEIC images, or DXF, STEP, STL or SVG CAD files.';

/**
 * Check the declared filename, content type and size before handing out an upload URL.
 * @throws ApiError 415 (unknown extension, content type that does not match it), 413 (too large).
 */
export function validateAttachmentRequest(input: CreateAttachmentRequest): ValidatedAttachment {
    const filename = displayFilename(input.filename);
    const ext = attachmentExtension(filename);
    const format = ATTACHMENT_FORMATS[ext];
    if (!format) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', ext ? `.${ext} files cannot be attached. ${ACCEPTED_COPY}` : `The file needs an extension. ${ACCEPTED_COPY}`, 415);
    const contentType = input.contentType.split(';')[0]!.trim().toLowerCase();
    if (!format.contentTypes.includes(contentType)) {
        throw new ApiError('UNSUPPORTED_MEDIA_TYPE', `The file says it is ${contentType || 'an unknown type'}, which does not match its .${ext} extension.`, 415, { reason: 'CONTENT_TYPE_MISMATCH' });
    }
    const maxBytes = maxBytesFor(format.kind);
    if (input.sizeBytes > maxBytes) {
        throw new ApiError('PAYLOAD_TOO_LARGE', `${format.kind === 'image' ? 'Images' : 'CAD files'} can be up to ${maxBytes / 1024 / 1024} MB.`, 413);
    }
    return { ext, kind: format.kind, contentType, filename, safeName: safeAttachmentFilename(filename), maxBytes };
}

export type SniffResult = { ok: true } | { ok: false; reason: string };

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => Buffer.from(b.subarray(from, Math.min(b.length, to))).toString('latin1');
const textHead = (b: Uint8Array, n = 4096) => ascii(b, 0, n).replace(/^﻿|^ï»¿/, '');

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

function isDxf(b: Uint8Array): boolean {
    if (ascii(b, 0, 18) === 'AutoCAD Binary DXF') return true;
    if (b.subarray(0, Math.min(b.length, 65536)).includes(0)) return false;
    const lines = textHead(b).split(/\r?\n/);
    let i = 0;
    while (i < lines.length && lines[i]!.trim() === '') i++;
    while (i + 1 < lines.length && lines[i]!.trim() === '999') i += 2;
    return lines[i]?.trim() === '0' && lines[i + 1]?.trim().toUpperCase() === 'SECTION';
}

function isStl(b: Uint8Array): boolean {
    if (b.length >= 84) {
        const triangles = Buffer.from(b.buffer, b.byteOffset, b.byteLength).readUInt32LE(80);
        if (84 + triangles * 50 === b.length) return true;
    }
    const head = textHead(b).trimStart().toLowerCase();
    return head.startsWith('solid') && /\bfacet\b|\bendsolid\b/.test(head) && !b.subarray(0, Math.min(b.length, 4096)).includes(0);
}

/** Script-capable SVG content is refused outright (it would run if ever opened on our origin). */
const SVG_ACTIVE_CONTENT = /<script|javascript:|<foreignobject|<!entity|<iframe|<embed|<object|\son[a-z]+\s*=/i;

function sniffSvg(b: Uint8Array): SniffResult {
    if (b.subarray(0, Math.min(b.length, 65536)).includes(0)) return { ok: false, reason: 'This is not an SVG file.' };
    const text = Buffer.from(b).toString('utf8').replace(/^﻿/, '');
    const head = text.slice(0, 4096).trimStart();
    if (!head.startsWith('<') || !/<svg[\s>]/i.test(text.slice(0, 65536))) return { ok: false, reason: 'This is not an SVG file.' };
    if (SVG_ACTIVE_CONTENT.test(text)) return { ok: false, reason: 'SVGs with scripts or embedded content cannot be attached. Export a plain SVG drawing.' };
    return { ok: true };
}

/** Magic-byte check of the uploaded bytes against the attachment's extension. */
export function sniffAttachment(bytes: Uint8Array, ext: string): SniffResult {
    if (bytes.length === 0) return { ok: false, reason: 'The file is empty.' };
    const mismatch = (what: string): SniffResult => ({ ok: false, reason: `The file's contents are not a ${what}, so it does not match its .${ext} extension.` });
    switch (ext) {
        case 'png':
            return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? { ok: true } : mismatch('PNG image');
        case 'jpg':
        case 'jpeg':
            return startsWith(bytes, [0xff, 0xd8, 0xff]) ? { ok: true } : mismatch('JPEG image');
        case 'webp':
            return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP' ? { ok: true } : mismatch('WebP image');
        case 'heic':
            return ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(bytes, 8, 12)) ? { ok: true } : mismatch('HEIC photo');
        case 'dxf':
            return isDxf(bytes) ? { ok: true } : mismatch('DXF drawing');
        case 'step':
        case 'stp':
            return textHead(bytes, 256).trimStart().startsWith('ISO-10303-21;') ? { ok: true } : mismatch('STEP model');
        case 'stl':
            return isStl(bytes) ? { ok: true } : mismatch('STL mesh');
        case 'svg':
            return sniffSvg(bytes);
        default:
            return { ok: false, reason: `.${ext} files cannot be attached.` };
    }
}

/** Images a browser can show inline as a thumbnail (HEIC cannot; SVG is never shown inline). */
export const THUMBNAIL_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export function attachmentStorageKey(buildId: string, attachmentId: string, safeName: string): string {
    return `builds/${buildId}/attachments/${attachmentId}/${safeName}`;
}
