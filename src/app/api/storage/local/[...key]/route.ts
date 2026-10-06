/**
 * Local object storage endpoint (STORAGE_DRIVER=local only).
 * Serves signed GET/PUT URLs minted by LocalDiskStorage.getSignedUrl().
 * Foundation-owned; not used when STORAGE_DRIVER=s3 (returns 404).
 */
import { env, requireSecret } from '@/server/env';
import { ApiError, errorResponse, readBodyBytes, route } from '@/server/http';
import { getStorage, verifyLocalSignature } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { key: string[] };

/** Ceiling for signed PUTs minted without an explicit maxBytes. */
const LOCAL_PUT_MAX_BYTES = 50 * 1024 * 1024;

function keyFrom(parts: string[]): string {
    return parts.map((p) => decodeURIComponent(p)).join('/');
}

export const GET = route<Params>(async (request, { params }) => {
    if (env().STORAGE_DRIVER !== 'local') return errorResponse('NOT_FOUND', 'Not found', 404);
    const key = keyFrom((await params).key);
    const v = verifyLocalSignature(requireSecret('STORAGE_SIGNING_SECRET'), key, new URL(request.url).searchParams, 'GET');
    if (!v) return errorResponse('FORBIDDEN', 'Invalid or expired signature', 403);
    const storage = getStorage();
    const [body, head] = await Promise.all([storage.getObject(key), storage.headObject(key)]);
    if (!body) return errorResponse('NOT_FOUND', 'Object not found', 404);
    const headers: Record<string, string> = {
        'content-type': head?.contentType ?? 'application/octet-stream',
        'content-length': String(body.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
    };
    if (v.downloadFilename) headers['content-disposition'] = `attachment; filename="${v.downloadFilename.replace(/"/g, '')}"`;
    return new Response(new Uint8Array(body), { status: 200, headers });
});

export const PUT = route<Params>(async (request, { params }) => {
    if (env().STORAGE_DRIVER !== 'local') return errorResponse('NOT_FOUND', 'Not found', 404);
    const key = keyFrom((await params).key);
    const v = verifyLocalSignature(requireSecret('STORAGE_SIGNING_SECRET'), key, new URL(request.url).searchParams, 'PUT');
    if (!v) return errorResponse('FORBIDDEN', 'Invalid or expired signature', 403);
    const contentType = request.headers.get('content-type') ?? '';
    if (v.contentType && contentType.split(';')[0].trim() !== v.contentType) {
        return errorResponse('UNSUPPORTED_MEDIA_TYPE', `Content-Type must be ${v.contentType}`, 415);
    }
    // Bounded read: the cap is enforced on the bytes actually streamed, not on Content-Length.
    const cap = v.maxBytes || LOCAL_PUT_MAX_BYTES;
    let body: Uint8Array;
    try {
        body = await readBodyBytes(request, cap);
    } catch (err) {
        if (err instanceof ApiError && err.code === 'PAYLOAD_TOO_LARGE') return errorResponse('PAYLOAD_TOO_LARGE', 'Upload exceeds size limit', 413);
        throw err;
    }
    await getStorage().putObject(key, body, { contentType: v.contentType || contentType || undefined });
    return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
});
