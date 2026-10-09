/**
 * Real state for the accounts suites: analyzed parts (through the quote engine) and placed
 * orders (through checkout), owned by a user and/or a guest device.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll } from 'vitest';
import type { Db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { createCheckout } from '@/server/orders';
import { analyzePart, createPartUpload, createQuote } from '@/server/quote';
import { getStorage, LocalDiskStorage, setStorage } from '@/server/storage';
import { sampleBracketDxf } from '@/lib/sample-dxf';
import { checkoutBody } from '../orders/fixtures';

export const AL_6061 = { materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090' } as const;

export function useLocalStorage(): void {
    let dir = '';
    beforeAll(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), 'dm-accounts-'));
        setStorage(new LocalDiskStorage({ rootDir: dir, appUrl: 'http://localhost:3100', signingSecret: process.env.STORAGE_SIGNING_SECRET ?? 'test-storage-secret' }));
    });
    afterAll(async () => {
        setStorage(null);
        if (dir) await rm(dir, { recursive: true, force: true });
    });
}

export type Owner = { ownerUserId?: string | null; deviceHash?: string | null };

/** Upload + analyze the sample bracket; returns the build and READY part. */
export async function analyzedPart(owner: Owner = {}, name = 'bracket.dxf') {
    const dxf = sampleBracketDxf();
    const created = await createPartUpload({ filename: name, sizeBytes: dxf.length }, owner);
    await getStorage().putObject(created.upload.key, new TextEncoder().encode(dxf), { contentType: 'application/dxf' });
    const part = await analyzePart(created.partId);
    if (part.status !== 'READY') throw new Error(`fixture part is ${part.status}`);
    return { buildId: created.buildId, partId: created.partId };
}

/** Quote + checkout + mark paid: a placed order on the part's build. */
export async function placedOrder(db: Db, partId: string, email: string, opts: { buyerUserId?: string | null; quantity?: number } = {}) {
    const quote = await createQuote({ partId, ...AL_6061, quantity: opts.quantity ?? 3 });
    if (!quote.orderable) throw new Error('fixture quote is not orderable');
    const order = await createCheckout(checkoutBody(quote.id, { buyer: { email, name: 'Ada Maker' } }), { buyerUserId: opts.buyerUserId ?? null });
    await db.update(orders).set({ status: 'PAID', paidAt: new Date() }).where(eq(orders.id, order.orderId));
    return { orderId: order.orderId, quoteId: quote.id };
}
