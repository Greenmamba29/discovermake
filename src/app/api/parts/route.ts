/**
 * POST /api/parts  CreatePartRequest -> CreatePartResponse (201), public.
 *
 * Creates a Build + Part and returns a signed upload target. The client then PUTs
 * the raw DXF bytes to `upload.url` with exactly `upload.headers` (or POSTs them to
 * /api/parts/:partId/upload) and calls POST /api/parts/:partId/analyze.
 * The build belongs to the signed-in user and/or this device (sets `dm_device` when missing).
 */
import { CreatePartRequest } from '@/contracts';
import { resolveBuildOwner } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { assertDxfFilename, createPartUpload, QUOTE_MAX_UPLOAD_BYTES, UnsupportedFileError } from '@/server/quote';
import { readJsonBody, validate } from '@/server/quote/route-helpers';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    // Body first (capped), so the guard's await never lets an unbounded stream buffer ahead.
    const raw = await readJsonBody(request);
    await assertNotKidMode(request);
    // Format + size checks first so STEP/DWG/oversize uploads get a specific message, not a schema error.
    if (raw && typeof raw === 'object') {
        const { filename, sizeBytes } = raw as { filename?: unknown; sizeBytes?: unknown };
        if (typeof filename === 'string' && filename.trim()) {
            try {
                assertDxfFilename(filename);
            } catch (err) {
                if (err instanceof UnsupportedFileError) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', err.message, 415, { reason: err.reason });
                throw err;
            }
        }
        if (typeof sizeBytes === 'number' && sizeBytes > QUOTE_MAX_UPLOAD_BYTES) {
            throw new ApiError('PAYLOAD_TOO_LARGE', `Files up to ${QUOTE_MAX_UPLOAD_BYTES / 1024 / 1024} MB can be quoted instantly. Simplify the drawing or contact support.`);
        }
    }
    const body = validate(raw, CreatePartRequest);
    const owner = await resolveBuildOwner(request);
    const res = json(await createPartUpload(body, owner), { status: 201 });
    owner.apply(res);
    return res;
});
