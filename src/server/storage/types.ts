/**
 * Object storage abstraction (CAD files, QA photos, labels).
 * Drivers: `local` (dev, files under `.data/storage`) and `s3` (any S3-compatible:
 * AWS S3, Cloudflare R2, Supabase Storage S3 endpoint, MinIO). Selected by STORAGE_DRIVER.
 *
 * Key conventions (always use these helpers' layout):
 *   parts/<partId>/source.dxf
 *   qa/<jobId>/<random>.<ext>
 *   labels/<shipmentId>.<ext>
 */
export type StorageDriverName = 'local' | 's3';

export type SignedUrlOptions = {
    method: 'GET' | 'PUT';
    /** Default 900 s (15 min). Max 7 days for S3. */
    expiresInSeconds?: number;
    /** PUT: the Content-Type the client must send (signed). */
    contentType?: string;
    /** PUT: max accepted bytes. Enforced by the local driver; S3 callers must re-check with headObject. */
    maxBytes?: number;
    /** GET: suggested download filename (Content-Disposition). */
    downloadFilename?: string;
};

export type SignedUrl = {
    url: string;
    method: 'GET' | 'PUT';
    /** Headers the client must send with the request (e.g. Content-Type for PUT). */
    headers: Record<string, string>;
    expiresAt: Date;
};

export type ObjectHead = {
    sizeBytes: number;
    contentType: string | null;
};

export interface Storage {
    readonly driver: StorageDriverName;
    /** Write an object (server-side upload). Overwrites. */
    putObject(key: string, body: Uint8Array | string, opts?: { contentType?: string }): Promise<void>;
    /** Read an object fully into memory; null when it does not exist. */
    getObject(key: string): Promise<Buffer | null>;
    /** Metadata, or null when it does not exist. */
    headObject(key: string): Promise<ObjectHead | null>;
    deleteObject(key: string): Promise<void>;
    /** Pre-signed URL for a browser/shop to GET or PUT an object directly. */
    getSignedUrl(key: string, opts: SignedUrlOptions): Promise<SignedUrl>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;

/** Reject path traversal and odd characters. Throws on an invalid key. */
export function assertValidKey(key: string): void {
    if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) {
        throw new Error(`Invalid storage key: ${key}`);
    }
}

export const storageKeys = {
    partSource: (partId: string) => `parts/${partId}/source.dxf`,
    qaPhoto: (jobId: string, random: string, ext: string) => `qa/${jobId}/${random}.${ext.replace(/^\./, '')}`,
    label: (shipmentId: string, ext: string) => `labels/${shipmentId}.${ext.replace(/^\./, '')}`,
};
