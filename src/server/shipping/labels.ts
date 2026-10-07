/**
 * Shipping labels: copy the carrier's label file into our own storage and hand it
 * out only as short-lived signed URLs (the provider URL is long-lived and public).
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { shipments } from '../db/schema';
import { getStorage, storageKeys } from '../storage';
import type { ShipmentRow } from './views';

/** Signed label links expire after 15 minutes; the console re-fetches the job for a fresh one. */
export const LABEL_URL_TTL_SECONDS = 900;
const MAX_LABEL_BYTES = 10 * 1024 * 1024;

const LABEL_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'application/zpl': 'zpl', 'application/x-zpl': 'zpl', 'text/plain': 'zpl' };

/**
 * Download the provider label and store it at `labels/<shipmentId>.<ext>`, recording
 * `shipments.label_key`. Idempotent; returns the key, or null when there is nothing to copy.
 * Throws on download/storage failure (callers run it after commit and only log).
 */
export async function archiveShipmentLabel(shipmentId: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
    const db = getDb();
    const [row] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
    if (!row || row.labelKey || !row.labelUrl || !isAllowedLabelUrl(row.labelUrl)) return row?.labelKey ?? null;
    const res = await fetchLabel(row.labelUrl, fetchFn);
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = LABEL_TYPES[contentType] ?? (/\.pdf(\?|$)/i.test(row.labelUrl) ? 'pdf' : /\.zpl(\?|$)/i.test(row.labelUrl) ? 'zpl' : 'png');
    const bytes = await readCapped(res, MAX_LABEL_BYTES);
    if (bytes.byteLength === 0) throw new Error('Label download was empty');
    const key = storageKeys.label(shipmentId, ext);
    await getStorage().putObject(key, bytes, { contentType: contentType || (ext === 'pdf' ? 'application/pdf' : ext === 'zpl' ? 'application/zpl' : 'image/png') });
    await db.update(shipments).set({ labelKey: key, updatedAt: new Date() }).where(eq(shipments.id, shipmentId));
    return key;
}

/**
 * Carrier label hosts we will download from. Redirects are followed manually (max 3)
 * and every hop must stay on HTTPS and on one of these domains, so a crafted label
 * URL cannot make the server fetch internal or arbitrary addresses (SSRF).
 */
const LABEL_HOST_SUFFIXES = ['easypost.com', 'easypostcdn.com', 'easypost-files.s3.amazonaws.com', 'easypost-files.s3-us-west-2.amazonaws.com'];

export function isAllowedLabelUrl(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase();
    return LABEL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

async function fetchLabel(start: string, fetchFn: typeof fetch): Promise<Response> {
    let url = start;
    for (let hop = 0; hop <= 3; hop++) {
        if (!isAllowedLabelUrl(url)) throw new Error('Label URL is not on an allowed carrier host');
        const res = await fetchFn(url, { redirect: 'manual' });
        if (res.status >= 300 && res.status < 400) {
            const next = res.headers.get('location');
            if (!next) throw new Error(`Label redirect without a location (HTTP ${res.status})`);
            url = new URL(next, url).toString();
            continue;
        }
        if (!res.ok) throw new Error(`Label download failed: HTTP ${res.status}`);
        return res;
    }
    throw new Error('Label download followed too many redirects');
}

/** Read a response body, aborting as soon as it exceeds `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > max) throw new Error(`Label is too large (${declared} bytes)`);
    if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, max + 1);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel();
            throw new Error(`Label is too large (over ${max} bytes)`);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}

/** Label link for the shop/ops views: a fresh signed URL to our copy, else the provider URL. */
export async function labelUrlFor(row: Pick<ShipmentRow, 'id' | 'labelKey' | 'labelUrl' | 'trackingNumber'>): Promise<string | null> {
    if (row.labelKey) {
        const ext = row.labelKey.split('.').pop() ?? 'pdf';
        const signed = await getStorage().getSignedUrl(row.labelKey, { method: 'GET', expiresInSeconds: LABEL_URL_TTL_SECONDS, downloadFilename: `label-${row.trackingNumber}.${ext}` });
        return signed.url;
    }
    return row.labelUrl;
}
