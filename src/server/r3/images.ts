/**
 * Image uploads for chat attachments and rating photos (signed PUT, like QA photos).
 * The upload is only accepted when the object exists under the expected prefix, is within
 * the size cap and its magic bytes are really PNG / JPEG / WebP; anything else is deleted.
 */
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, type ImageUploadRequest, type ImageUploadResponse } from '../../contracts/prime';
import { ApiError } from '../http';
import { randomBase32 } from '../ids';
import { getStorage } from '../storage';

export const IMAGE_UPLOAD_TTL_SECONDS = 15 * 60;
const EXT: Record<(typeof IMAGE_CONTENT_TYPES)[number], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Sniff an image type from its first bytes (null when it is none of PNG / JPEG / WebP). */
export function sniffImage(bytes: Uint8Array): (typeof IMAGE_CONTENT_TYPES)[number] | null {
    const b = bytes;
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return null;
}

export async function createImageUpload(prefix: string, input: ImageUploadRequest): Promise<ImageUploadResponse> {
    const key = `${prefix}/${randomBase32(16).toLowerCase()}.${EXT[input.contentType]}`;
    const signed = await getStorage().getSignedUrl(key, { method: 'PUT', contentType: input.contentType, maxBytes: input.sizeBytes, expiresInSeconds: IMAGE_UPLOAD_TTL_SECONDS });
    return { key, upload: { url: signed.url, method: 'PUT', headers: signed.headers, expiresAt: signed.expiresAt.toISOString() } };
}

/** Verify an uploaded image key belongs under `prefix`, exists, fits the cap and is a real image. */
export async function verifyUploadedImage(key: string, prefix: string): Promise<string> {
    if (!key.startsWith(`${prefix}/`) || key.includes('..') || !/^[A-Za-z0-9/_.-]+$/.test(key)) {
        throw new ApiError('VALIDATION_FAILED', 'That photo does not belong to this order. Upload it again.');
    }
    const storage = getStorage();
    const head = await storage.headObject(key);
    if (!head) throw new ApiError('VALIDATION_FAILED', 'The photo upload did not finish. Try again.');
    if (head.sizeBytes > MAX_IMAGE_BYTES || head.sizeBytes === 0) {
        await storage.deleteObject(key).catch(() => undefined);
        throw new ApiError('PAYLOAD_TOO_LARGE', 'Photos must be 8 MB or smaller.');
    }
    const bytes = await storage.getObject(key);
    const kind = bytes ? sniffImage(new Uint8Array(bytes.subarray(0, 16))) : null;
    if (!kind) {
        await storage.deleteObject(key).catch(() => undefined);
        throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Only PNG, JPEG or WebP photos are accepted.');
    }
    return key;
}

/** Short-lived signed GET URL for an image key (null-safe). */
export async function imageUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
        return (await getStorage().getSignedUrl(key, { method: 'GET', expiresInSeconds: 3600 })).url;
    } catch {
        return null;
    }
}
