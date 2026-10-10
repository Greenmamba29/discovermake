/**
 * Antivirus scan for every uploaded file (GA hardening, 001-8), via ClamAV's `clamd`
 * INSTREAM protocol over TCP. No package: the protocol is a few framed writes.
 *
 *   CLAMAV_HOST / CLAMAV_PORT (default 3310)  - enable scanning
 *   UPLOAD_SCAN_REQUIRED=true                 - refuse uploads when scanning is not
 *                                               configured or clamd is unreachable
 *
 * Without CLAMAV_HOST and without UPLOAD_SCAN_REQUIRED, uploads are accepted unscanned
 * (dev, tests). Parsers stay defensive regardless: DXF parsing has hard work budgets and
 * images/CAD attachments are checked by magic bytes.
 */
import net from 'node:net';
import { env } from '../env';
import { ApiError } from '../http';

export type ScanVerdict = { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'skipped'; reason: string };

const CHUNK = 64 * 1024;
/** Base timeout plus time for the bytes at a conservative 1 MB/s, so large files are not cut off. */
const TIMEOUT_BASE_MS = 15_000;
const TIMEOUT_PER_MB_MS = 1_000;
const timeoutFor = (bytes: number) => TIMEOUT_BASE_MS + Math.ceil(bytes / (1024 * 1024)) * TIMEOUT_PER_MB_MS;

/** Low level: stream `bytes` to clamd and return its verdict line. */
export function clamdScan(bytes: Uint8Array, opts: { host: string; port: number; timeoutMs?: number }): Promise<ScanVerdict> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: opts.host, port: opts.port });
        let reply = '';
        const fail = (err: Error) => {
            socket.destroy();
            reject(err);
        };
        socket.setTimeout(opts.timeoutMs ?? timeoutFor(bytes.byteLength), () => fail(new Error('clamd timed out')));
        socket.on('error', fail);
        socket.on('data', (d) => {
            reply += d.toString('utf8');
        });
        socket.on('end', () => {
            const line = reply.replace(/\0/g, '').trim();
            // "stream: OK" | "stream: Eicar-Signature FOUND" | "INSTREAM size limit exceeded. ERROR"
            if (/:\s*OK$/.test(line)) return resolve({ status: 'clean' });
            const found = /:\s*(.+)\s+FOUND$/.exec(line);
            if (found) return resolve({ status: 'infected', signature: found[1]!.slice(0, 200) });
            reject(new Error(`clamd: ${line.slice(0, 200) || 'empty reply'}`));
        });
        socket.on('connect', () => {
            // Respect backpressure: wait for 'drain' whenever the socket buffer is full.
            const write = (chunk: Uint8Array) => (socket.write(chunk) ? Promise.resolve() : new Promise<void>((r) => socket.once('drain', () => r())));
            void (async () => {
                await write(Buffer.from('zINSTREAM\0'));
                for (let off = 0; off < bytes.byteLength; off += CHUNK) {
                    const part = bytes.subarray(off, Math.min(off + CHUNK, bytes.byteLength));
                    const len = Buffer.alloc(4);
                    len.writeUInt32BE(part.byteLength, 0);
                    await write(len);
                    await write(part);
                }
                socket.end(Buffer.alloc(4)); // zero-length chunk terminates the stream
            })().catch(fail);
        });
    });
}

/**
 * Scan an upload before it is accepted. Throws 422 VALIDATION_FAILED for infected files
 * and 503 when scanning is required but unavailable; returns the verdict otherwise.
 */
export async function scanUpload(bytes: Uint8Array, meta: { filename: string }): Promise<ScanVerdict> {
    const { CLAMAV_HOST, CLAMAV_PORT, UPLOAD_SCAN_REQUIRED } = env();
    if (!CLAMAV_HOST) {
        if (UPLOAD_SCAN_REQUIRED) throw new ApiError('INTERNAL', 'Uploads are unavailable: file scanning is not configured on this server.', 503, { reason: 'scan_not_configured' });
        return { status: 'skipped', reason: 'not_configured' };
    }
    let verdict: ScanVerdict;
    try {
        verdict = await clamdScan(bytes, { host: CLAMAV_HOST, port: CLAMAV_PORT });
    } catch (err) {
        console.error(JSON.stringify({ event: 'upload.scan_unavailable', message: err instanceof Error ? err.message : String(err) }));
        if (UPLOAD_SCAN_REQUIRED) throw new ApiError('INTERNAL', 'Uploads are paused: file scanning is temporarily unavailable. Try again shortly.', 503, { reason: 'scan_unavailable' });
        return { status: 'skipped', reason: 'unavailable' };
    }
    if (verdict.status === 'infected') {
        console.warn(JSON.stringify({ event: 'upload.infected', filename: meta.filename.slice(0, 120), signature: verdict.signature }));
        throw new ApiError('VALIDATION_FAILED', 'This file was flagged by our malware scan and was not accepted.', 422, { reason: 'infected' });
    }
    return verdict;
}
