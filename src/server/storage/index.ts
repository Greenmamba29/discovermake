/**
 * `getStorage()` — the configured object store (STORAGE_DRIVER=local|s3).
 * Tests may inject a driver with `setStorage()`.
 */
import { env, requireSecret } from '../env';
import { LocalDiskStorage } from './local';
import { S3Storage } from './s3';
import type { Storage } from './types';

export * from './types';
export { LocalDiskStorage, LOCAL_STORAGE_ROUTE, verifyLocalSignature } from './local';
export { S3Storage } from './s3';

let instance: Storage | null = null;

export function getStorage(): Storage {
    if (instance) return instance;
    const e = env();
    if (e.STORAGE_DRIVER === 's3') {
        if (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
            throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
        }
        instance = new S3Storage({
            bucket: e.S3_BUCKET,
            region: e.S3_REGION,
            endpoint: e.S3_ENDPOINT,
            accessKeyId: e.S3_ACCESS_KEY_ID,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY,
            forcePathStyle: e.S3_FORCE_PATH_STYLE,
        });
    } else {
        instance = new LocalDiskStorage({
            rootDir: e.STORAGE_LOCAL_DIR,
            appUrl: e.APP_URL,
            signingSecret: requireSecret('STORAGE_SIGNING_SECRET'),
        });
    }
    return instance;
}

/** Test hook: inject a driver (pass null to reset to env-configured). */
export function setStorage(storage: Storage | null): void {
    instance = storage;
}
