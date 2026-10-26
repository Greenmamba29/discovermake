/**
 * NetlifyBlobsStorage: objects in a Netlify Blobs store. Netlify functions have no writable,
 * shared disk, so the local driver cannot work there; Blobs needs no credentials on Netlify.
 *
 * Signed URLs are the local driver's (`/api/storage/local/<key>`, HMAC over method, key, expiry,
 * content type and size cap): only where the bytes live differs. Reads use strong consistency so
 * an object written by one request is visible to the next (upload, then analyse).
 */
import { getStore, type Store } from '@netlify/blobs';
import { LocalDiskStorage, type LocalDiskStorageOptions } from './local';
import { assertValidKey, type ObjectHead, type StorageDriverName } from './types';

export const NETLIFY_BLOBS_STORE = 'discovermake-objects';

type Meta = { contentType?: string };

export class NetlifyBlobsStorage extends LocalDiskStorage {
    override readonly driver: StorageDriverName = 'netlify-blobs';
    private store: Store | null;

    constructor(opts: Omit<LocalDiskStorageOptions, 'rootDir'>, store?: Store) {
        super({ ...opts, rootDir: '.data/unused-netlify-blobs' });
        this.store = store ?? null;
    }

    private blobs(): Store {
        this.store ??= getStore({ name: NETLIFY_BLOBS_STORE, consistency: 'strong' });
        return this.store;
    }

    override async putObject(key: string, body: Uint8Array | string, opts?: { contentType?: string }): Promise<void> {
        assertValidKey(key);
        const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
        const metadata: Meta = opts?.contentType ? { contentType: opts.contentType } : {};
        await this.blobs().set(key, new Blob([new Uint8Array(bytes)]), { metadata });
    }

    override async getObject(key: string): Promise<Buffer | null> {
        assertValidKey(key);
        const data = await this.blobs().get(key, { type: 'arrayBuffer' });
        return data ? Buffer.from(data) : null;
    }

    override async headObject(key: string): Promise<ObjectHead | null> {
        assertValidKey(key);
        const hit = await this.blobs().getWithMetadata(key, { type: 'arrayBuffer' });
        if (!hit) return null;
        return { sizeBytes: hit.data.byteLength, contentType: (hit.metadata as Meta).contentType ?? null };
    }

    override async deleteObject(key: string): Promise<void> {
        assertValidKey(key);
        await this.blobs().delete(key);
    }
}
