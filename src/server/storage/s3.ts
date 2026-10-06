/**
 * S3Storage: any S3-compatible object store (AWS S3, Cloudflare R2, Supabase
 * Storage's S3 endpoint, MinIO). Configure with S3_* env vars.
 */
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
    S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { assertValidKey, type ObjectHead, type SignedUrl, type SignedUrlOptions, type Storage } from './types';

export type S3StorageOptions = {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
};

function isNotFound(err: unknown): boolean {
    if (err instanceof S3ServiceException) {
        return err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404;
    }
    return false;
}

export class S3Storage implements Storage {
    readonly driver = 's3' as const;
    private readonly client: S3Client;

    constructor(private readonly opts: S3StorageOptions) {
        this.client = new S3Client({
            region: opts.region,
            endpoint: opts.endpoint,
            forcePathStyle: opts.forcePathStyle,
            credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
        });
    }

    async putObject(key: string, body: Uint8Array | string, opts?: { contentType?: string }): Promise<void> {
        assertValidKey(key);
        await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: opts?.contentType }));
    }

    async getObject(key: string): Promise<Buffer | null> {
        assertValidKey(key);
        try {
            const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
            if (!res.Body) return null;
            return Buffer.from(await res.Body.transformToByteArray());
        } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
        }
    }

    async headObject(key: string): Promise<ObjectHead | null> {
        assertValidKey(key);
        try {
            const res = await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
            return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
        } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
        }
    }

    async deleteObject(key: string): Promise<void> {
        assertValidKey(key);
        await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    }

    async getSignedUrl(key: string, opts: SignedUrlOptions): Promise<SignedUrl> {
        assertValidKey(key);
        const expiresIn = Math.min(opts.expiresInSeconds ?? 900, 7 * 24 * 3600);
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        if (opts.method === 'PUT') {
            const url = await presign(
                this.client,
                new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, ContentType: opts.contentType }),
                { expiresIn },
            );
            return { url, method: 'PUT', headers: opts.contentType ? { 'content-type': opts.contentType } : {}, expiresAt };
        }
        const url = await presign(
            this.client,
            new GetObjectCommand({
                Bucket: this.opts.bucket,
                Key: key,
                ResponseContentDisposition: opts.downloadFilename ? `attachment; filename="${opts.downloadFilename.replace(/"/g, '')}"` : undefined,
            }),
            { expiresIn },
        );
        return { url, method: 'GET', headers: {}, expiresAt };
    }
}
