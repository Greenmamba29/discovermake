/**
 * LocalDiskStorage: dev/test driver. Objects live under STORAGE_LOCAL_DIR
 * (default `.data/storage`, gitignored). Signed URLs point at
 * `/api/storage/local/<key>` and carry an HMAC over method, key, expiry,
 * content type and size cap (verified by `verifyLocalSignature`).
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hmacHex, safeEqual } from '../auth/tokens';
import { assertValidKey, type ObjectHead, type SignedUrl, type SignedUrlOptions, type Storage } from './types';

export type LocalDiskStorageOptions = {
    rootDir: string;
    appUrl: string;
    signingSecret: string;
};

export const LOCAL_STORAGE_ROUTE = '/api/storage/local';

export class LocalDiskStorage implements Storage {
    readonly driver = 'local' as const;
    private readonly root: string;

    constructor(private readonly opts: LocalDiskStorageOptions) {
        this.root = path.resolve(opts.rootDir);
    }

    private pathFor(key: string): string {
        assertValidKey(key);
        const p = path.resolve(this.root, key);
        if (!p.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
        return p;
    }

    async putObject(key: string, body: Uint8Array | string, opts?: { contentType?: string }): Promise<void> {
        const p = this.pathFor(key);
        await mkdir(path.dirname(p), { recursive: true });
        await writeFile(p, body);
        if (opts?.contentType) await writeFile(`${p}.__meta.json`, JSON.stringify({ contentType: opts.contentType }));
    }

    async getObject(key: string): Promise<Buffer | null> {
        try {
            return await readFile(this.pathFor(key));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw err;
        }
    }

    async headObject(key: string): Promise<ObjectHead | null> {
        const p = this.pathFor(key);
        try {
            const s = await stat(p);
            let contentType: string | null = null;
            try {
                contentType = JSON.parse(await readFile(`${p}.__meta.json`, 'utf8')).contentType ?? null;
            } catch {
                /* no metadata */
            }
            return { sizeBytes: s.size, contentType };
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw err;
        }
    }

    async deleteObject(key: string): Promise<void> {
        const p = this.pathFor(key);
        await rm(p, { force: true });
        await rm(`${p}.__meta.json`, { force: true });
    }

    async getSignedUrl(key: string, opts: SignedUrlOptions): Promise<SignedUrl> {
        assertValidKey(key);
        const expiresAt = new Date(Date.now() + (opts.expiresInSeconds ?? 900) * 1000);
        const exp = Math.floor(expiresAt.getTime() / 1000);
        const ct = opts.method === 'PUT' ? (opts.contentType ?? '') : '';
        const max = opts.method === 'PUT' ? (opts.maxBytes ?? 0) : 0;
        const fn = opts.method === 'GET' ? (opts.downloadFilename ?? '') : '';
        const sig = localSignature(this.opts.signingSecret, { method: opts.method, key, exp, ct, max, fn });
        const u = new URL(`${LOCAL_STORAGE_ROUTE}/${key}`, this.opts.appUrl);
        u.searchParams.set('m', opts.method);
        u.searchParams.set('exp', String(exp));
        if (ct) u.searchParams.set('ct', ct);
        if (max) u.searchParams.set('max', String(max));
        if (fn) u.searchParams.set('fn', fn);
        u.searchParams.set('sig', sig);
        return {
            url: u.toString(),
            method: opts.method,
            headers: ct ? { 'content-type': ct } : {},
            expiresAt,
        };
    }
}

type SigParts = { method: string; key: string; exp: number; ct: string; max: number; fn: string };

export function localSignature(secret: string, p: SigParts): string {
    return hmacHex(secret, [p.method, p.key, p.exp, p.ct, p.max, p.fn].join('\n'));
}

export type VerifiedLocalRequest = { method: 'GET' | 'PUT'; key: string; contentType: string; maxBytes: number; downloadFilename: string };

/** Verify a local signed URL. Returns null when the signature is invalid or expired. */
export function verifyLocalSignature(secret: string, key: string, params: URLSearchParams, method: string, now = Date.now()): VerifiedLocalRequest | null {
    const m = params.get('m');
    const exp = Number(params.get('exp'));
    const sig = params.get('sig') ?? '';
    if ((m !== 'GET' && m !== 'PUT') || m !== method) return null;
    if (!Number.isFinite(exp) || exp * 1000 < now) return null;
    try {
        assertValidKey(key);
    } catch {
        return null;
    }
    const ct = params.get('ct') ?? '';
    const max = Number(params.get('max') ?? 0) || 0;
    const fn = params.get('fn') ?? '';
    const expected = localSignature(secret, { method: m, key, exp, ct, max, fn });
    if (!safeEqual(expected, sig)) return null;
    return { method: m, key, contentType: ct, maxBytes: max, downloadFilename: fn };
}
