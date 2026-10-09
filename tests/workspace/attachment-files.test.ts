/**
 * Attachment validation (100-1), pure: size caps, extension / content-type matching, magic
 * bytes per format, and filenames that try to escape the attachment folder.
 */
import { describe, expect, it } from 'vitest';
import { MAX_CAD_ATTACHMENT_BYTES, MAX_IMAGE_ATTACHMENT_BYTES } from '@/contracts/workspace';
import { ApiError } from '@/server/http';
import { assertValidKey } from '@/server/storage';
import { attachmentStorageKey, displayFilename, safeAttachmentFilename, sniffAttachment, validateAttachmentRequest } from '@/server/workspace/attachment-files';
import { attachmentBytes } from './fixtures';

function rejects(fn: () => unknown): ApiError {
    try {
        fn();
    } catch (err) {
        if (err instanceof ApiError) return err;
        throw err;
    }
    throw new Error('expected an ApiError');
}

describe('validateAttachmentRequest', () => {
    it('accepts the listed image and CAD formats with their kind and cap', () => {
        expect(validateAttachmentRequest({ filename: 'sketch.PNG', contentType: 'image/png', sizeBytes: 1000 })).toMatchObject({ ext: 'png', kind: 'image', maxBytes: MAX_IMAGE_ATTACHMENT_BYTES });
        expect(validateAttachmentRequest({ filename: 'photo.heic', contentType: 'image/heif', sizeBytes: 1000 })).toMatchObject({ kind: 'image' });
        expect(validateAttachmentRequest({ filename: 'panel.dxf', contentType: 'application/octet-stream', sizeBytes: 1000 })).toMatchObject({ kind: 'cad', maxBytes: MAX_CAD_ATTACHMENT_BYTES });
        expect(validateAttachmentRequest({ filename: 'body.stp', contentType: 'model/step', sizeBytes: 1000 })).toMatchObject({ ext: 'stp', kind: 'cad' });
        expect(validateAttachmentRequest({ filename: 'mesh.stl', contentType: 'model/stl; charset=binary', sizeBytes: 1000 })).toMatchObject({ contentType: 'model/stl' });
    });

    it('enforces 15 MB for images and 50 MB for CAD', () => {
        expect(validateAttachmentRequest({ filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: MAX_IMAGE_ATTACHMENT_BYTES }).kind).toBe('image');
        const img = rejects(() => validateAttachmentRequest({ filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: MAX_IMAGE_ATTACHMENT_BYTES + 1 }));
        expect(img.status).toBe(413);
        expect(img.message).toMatch(/15 MB/);
        expect(validateAttachmentRequest({ filename: 'a.step', contentType: 'application/step', sizeBytes: 20 * 1024 * 1024 }).kind).toBe('cad');
        const cad = rejects(() => validateAttachmentRequest({ filename: 'a.step', contentType: 'application/step', sizeBytes: MAX_CAD_ATTACHMENT_BYTES + 1 }));
        expect(cad.status).toBe(413);
    });

    it('refuses unknown extensions and content types that do not match the extension', () => {
        expect(rejects(() => validateAttachmentRequest({ filename: 'virus.exe', contentType: 'application/octet-stream', sizeBytes: 10 })).status).toBe(415);
        expect(rejects(() => validateAttachmentRequest({ filename: 'noext', contentType: 'image/png', sizeBytes: 10 })).status).toBe(415);
        const mismatch = rejects(() => validateAttachmentRequest({ filename: 'photo.png', contentType: 'image/jpeg', sizeBytes: 10 }));
        expect(mismatch.status).toBe(415);
        expect(mismatch.details).toEqual({ reason: 'CONTENT_TYPE_MISMATCH' });
        // Images may not claim octet-stream; SVG must say image/svg+xml.
        expect(rejects(() => validateAttachmentRequest({ filename: 'photo.webp', contentType: 'application/octet-stream', sizeBytes: 10 })).status).toBe(415);
        expect(rejects(() => validateAttachmentRequest({ filename: 'logo.svg', contentType: 'text/html', sizeBytes: 10 })).status).toBe(415);
    });
});

describe('filenames', () => {
    it.each([
        ['../../etc/passwd.png', 'passwd.png'],
        ['..\\..\\windows\\win.ini.dxf', 'win.ini.dxf'],
        ['/abs/path/to/part.step', 'part.step'],
        ['....png', 'file.png'],
        ['my bracket (final) v2.DXF', 'my-bracket-final-v2.dxf'],
        ['Größe 10×20.png', 'Groe-1020.png'],
        ['.hidden.stl', 'hidden.stl'],
        ['a..b..c.svg', 'a.b.c.svg'],
        ['name\u0000with\u0007ctrl.jpg', 'namewithctrl.jpg'],
    ])('%j -> %j', (input, safe) => {
        const out = safeAttachmentFilename(input);
        expect(out).toBe(safe);
        expect(out).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
        expect(out).not.toContain('..');
        const key = attachmentStorageKey('bld_x', 'att_y', out);
        expect(() => assertValidKey(key)).not.toThrow();
        expect(key.startsWith('builds/bld_x/attachments/att_y/')).toBe(true);
        expect(key.split('/')).toHaveLength(5);
    });

    it('keeps a readable display name without the path', () => {
        expect(displayFilename('../../secret/Bracket v2.dxf')).toBe('Bracket v2.dxf');
        expect(validateAttachmentRequest({ filename: '../../x/y/Plate.png', contentType: 'image/png', sizeBytes: 5 })).toMatchObject({ filename: 'Plate.png', safeName: 'Plate.png' });
    });
});

describe('sniffAttachment (magic bytes)', () => {
    it.each(['png', 'jpg', 'webp', 'heic', 'dxf', 'step', 'stl', 'svg'] as const)('accepts a real %s', (ext) => {
        expect(sniffAttachment(attachmentBytes(ext), ext)).toEqual({ ok: true });
    });

    it('accepts binary STL, binary DXF and jpeg/stp aliases', () => {
        expect(sniffAttachment(attachmentBytes('stl-binary'), 'stl')).toEqual({ ok: true });
        expect(sniffAttachment(attachmentBytes('dxf-binary'), 'dxf')).toEqual({ ok: true });
        expect(sniffAttachment(attachmentBytes('jpg'), 'jpeg')).toEqual({ ok: true });
        expect(sniffAttachment(attachmentBytes('step'), 'stp')).toEqual({ ok: true });
    });

    it('refuses bytes that do not match the extension', () => {
        expect(sniffAttachment(attachmentBytes('jpg'), 'png').ok).toBe(false);
        expect(sniffAttachment(attachmentBytes('png'), 'webp').ok).toBe(false);
        expect(sniffAttachment(attachmentBytes('png'), 'heic').ok).toBe(false);
        expect(sniffAttachment(attachmentBytes('step'), 'dxf').ok).toBe(false);
        expect(sniffAttachment(attachmentBytes('dxf'), 'step').ok).toBe(false);
        expect(sniffAttachment(new TextEncoder().encode('<html><body>hi</body></html>'), 'svg').ok).toBe(false);
        expect(sniffAttachment(new TextEncoder().encode('MZ\x90\x00 not an stl'), 'stl').ok).toBe(false);
        const r = sniffAttachment(attachmentBytes('png'), 'jpg');
        expect(r.ok === false && r.reason).toMatch(/does not match its \.jpg extension/);
        expect(sniffAttachment(new Uint8Array(0), 'png')).toEqual({ ok: false, reason: 'The file is empty.' });
    });

    it('refuses SVGs with scripts or event handlers', () => {
        for (const evil of [
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
        ]) {
            const r = sniffAttachment(new TextEncoder().encode(evil), 'svg');
            expect(r.ok).toBe(false);
        }
    });
});
