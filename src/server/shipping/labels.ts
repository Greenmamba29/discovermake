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
    if (!row || row.labelKey || !row.labelUrl || !/^https:\/\//.test(row.labelUrl)) return row?.labelKey ?? null;
    const res = await fetchFn(row.labelUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Label download failed: HTTP ${res.status}`);
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = LABEL_TYPES[contentType] ?? (/\.pdf(\?|$)/i.test(row.labelUrl) ? 'pdf' : /\.zpl(\?|$)/i.test(row.labelUrl) ? 'zpl' : 'png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LABEL_BYTES) throw new Error(`Label has an unexpected size (${bytes.byteLength} bytes)`);
    const key = storageKeys.label(shipmentId, ext);
    await getStorage().putObject(key, bytes, { contentType: contentType || (ext === 'pdf' ? 'application/pdf' : ext === 'zpl' ? 'application/zpl' : 'image/png') });
    await db.update(shipments).set({ labelKey: key, updatedAt: new Date() }).where(eq(shipments.id, shipmentId));
    return key;
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
