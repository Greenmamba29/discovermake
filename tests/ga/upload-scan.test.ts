import net from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { clamdScan, scanUpload } from '@/server/security/upload-scan';
import { createPartUpload, uploadPartBytes } from '@/server/quote';
import { sampleBracketDxf } from '@/lib/sample-dxf';
import { useTestDb as withTestDb } from '../support/db';

/** A minimal clamd speaking INSTREAM: decodes the chunks and answers like the real daemon. */
function fakeClamd(): Promise<{ port: number; close: () => Promise<void>; received: () => Buffer[] }> {
    const got: Buffer[] = [];
    const server = net.createServer((sock) => {
        let buf = Buffer.alloc(0);
        sock.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            const cmd = 'zINSTREAM\0';
            if (buf.length < cmd.length) return;
            let off = cmd.length;
            const chunks: Buffer[] = [];
            while (buf.length >= off + 4) {
                const len = buf.readUInt32BE(off);
                if (len === 0) {
                    const body = Buffer.concat(chunks);
                    got.push(body);
                    const text = body.toString('latin1');
                    if (text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) sock.end('stream: Eicar-Test-Signature FOUND\0');
                    else if (text.includes('BREAK-THE-SCANNER')) sock.end('INSTREAM size limit exceeded. ERROR\0');
                    else sock.end('stream: OK\0');
                    return;
                }
                if (buf.length < off + 4 + len) return;
                chunks.push(buf.subarray(off + 4, off + 4 + len));
                off += 4 + len;
            }
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            resolve({ port, received: () => got, close: () => new Promise((r) => server.close(() => r())) });
        });
    });
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
let clamd: Awaited<ReturnType<typeof fakeClamd>>;

beforeAll(async () => {
    clamd = await fakeClamd();
});
afterAll(async () => clamd.close());
afterEach(() => {
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
    delete process.env.UPLOAD_SCAN_REQUIRED;
    resetEnvCache();
});

const configure = (extra: Record<string, string> = {}) => {
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(clamd.port);
    Object.assign(process.env, extra);
    resetEnvCache();
};

describe('clamd INSTREAM client', () => {
    it('streams large files in chunks and reads a clean verdict', async () => {
        const big = new Uint8Array(200 * 1024).fill(65);
        expect(await clamdScan(big, { host: '127.0.0.1', port: clamd.port })).toEqual({ status: 'clean' });
        expect(clamd.received().at(-1)!.byteLength).toBe(big.byteLength);
    });

    it('reports the signature of an infected file', async () => {
        expect(await clamdScan(Buffer.from(EICAR), { host: '127.0.0.1', port: clamd.port })).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
    });
});

describe('scanUpload policy', () => {
    it('skips when not configured and not required (dev, tests)', async () => {
        expect(await scanUpload(Buffer.from('hello'), { filename: 'a.dxf' })).toEqual({ status: 'skipped', reason: 'not_configured' });
    });

    it('refuses uploads when scanning is required but not configured', async () => {
        process.env.UPLOAD_SCAN_REQUIRED = 'true';
        resetEnvCache();
        await expect(scanUpload(Buffer.from('hello'), { filename: 'a.dxf' })).rejects.toMatchObject({ status: 503 });
    });

    it('rejects an infected upload with 422', async () => {
        configure();
        await expect(scanUpload(Buffer.from(EICAR), { filename: 'evil.dxf' })).rejects.toMatchObject({ status: 422, details: { reason: 'infected' } });
    });

    it('fails closed when required and clamd errors, open otherwise', async () => {
        configure();
        expect(await scanUpload(Buffer.from('BREAK-THE-SCANNER'), { filename: 'a.dxf' })).toEqual({ status: 'skipped', reason: 'unavailable' });
        configure({ UPLOAD_SCAN_REQUIRED: 'true' });
        await expect(scanUpload(Buffer.from('BREAK-THE-SCANNER'), { filename: 'a.dxf' })).rejects.toMatchObject({ status: 503 });
    });

    it('accepts a clean upload', async () => {
        configure({ UPLOAD_SCAN_REQUIRED: 'true' });
        expect(await scanUpload(Buffer.from('0\nSECTION\n'), { filename: 'a.dxf' })).toEqual({ status: 'clean' });
    });
});

describe('part uploads are scanned', () => {
    withTestDb({ seed: true });

    it('refuses a DXF that carries a malware signature, accepts a clean one', async () => {
        configure({ UPLOAD_SCAN_REQUIRED: 'true' });
        const clean = sampleBracketDxf();
        const infected = `999\n${EICAR}\n${clean}`;
        const a = await createPartUpload({ filename: 'clean.dxf', sizeBytes: clean.length });
        await expect(uploadPartBytes(a.partId, new TextEncoder().encode(clean))).resolves.toMatchObject({ id: a.partId });
        const b = await createPartUpload({ filename: 'evil.dxf', sizeBytes: infected.length });
        await expect(uploadPartBytes(b.partId, new TextEncoder().encode(infected))).rejects.toMatchObject({ status: 422 });
    });
});
