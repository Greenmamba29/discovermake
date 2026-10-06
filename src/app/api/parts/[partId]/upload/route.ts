/**
 * POST|PUT /api/parts/:partId/upload -> PartView (public; ids are unguessable).
 *
 * Direct upload alternative to the signed PUT URL (handy with STORAGE_DRIVER=local
 * and for clients that cannot PUT to object storage). Accepts multipart/form-data
 * with a `file` field, or the raw DXF bytes as the body. 25 MB cap; the content is
 * sniffed immediately (ASCII DXF R12–R2018 only).
 */
import { PartId } from '@/contracts';
import { ApiError, json, route } from '@/server/http';
import { QUOTE_MAX_UPLOAD_BYTES, uploadPartBytes } from '@/server/quote';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readUpload(request: Request): Promise<Uint8Array> {
    const declared = Number(request.headers.get('content-length') ?? 0);
    // multipart adds a little framing overhead on top of the file itself
    if (declared > QUOTE_MAX_UPLOAD_BYTES + 64 * 1024) throw new ApiError('PAYLOAD_TOO_LARGE', `Files up to ${QUOTE_MAX_UPLOAD_BYTES / 1024 / 1024} MB can be quoted instantly.`);
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
        let form: FormData;
        try {
            form = await request.formData();
        } catch {
            throw new ApiError('BAD_REQUEST', 'Malformed multipart body');
        }
        const file = form.get('file');
        if (!file || typeof file === 'string') throw new ApiError('VALIDATION_FAILED', 'Attach the DXF as a form field named "file"');
        if (file.name && !/\.dxf$/i.test(file.name)) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'R1 accepts .dxf files only (ASCII DXF, R12–R2018).', 415);
        return new Uint8Array(await file.arrayBuffer());
    }
    return new Uint8Array(await request.arrayBuffer());
}

const handler = route<{ partId: string }>(async (request, { params }) => {
    const partId = pathId((await params).partId, PartId, 'Part');
    const bytes = await readUpload(request);
    if (bytes.byteLength === 0) throw new ApiError('VALIDATION_FAILED', 'The upload is empty');
    return json(await uploadPartBytes(partId, bytes));
});

export const POST = handler;
export const PUT = handler;
