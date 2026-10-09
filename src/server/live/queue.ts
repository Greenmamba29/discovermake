/**
 * Fair queue for high-demand drops (R5, workflow 06 "Build Slots").
 *
 * A drop started with `fairQueue: true` refuses direct claims. Instead:
 *   enqueue   the claim is stored with its arrival second and a random 31-bit tie-break;
 *             one QUEUED entry per buyer and drop
 *   process   under the drop row lock (the same lock direct claims use), entries whose second
 *             has fully passed are admitted in (second, tie-break, id) order: each runs the
 *             normal claim (claimSlotsLocked) in a savepoint; a refused claim (sold out,
 *             per-buyer limit, drop closed) marks the entry REJECTED with the reason
 *   position  1 + QUEUED entries ahead of yours
 * Processing runs lazily on every enqueue and position poll, and from the drop sweep, so the
 * queue drains with or without a cron. Claims that arrive in the same second are therefore
 * ordered at random instead of by network latency, and the row lock still guarantees no oversell.
 */
import { randomInt } from 'node:crypto';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { ClaimSlotsRequest, type DropQueueResponse } from '../../contracts/live';
import type { ViewerContext } from '../auth/viewer';
import { getDb, withTx } from '../db';
import { dropQueueEntries, drops, payments, slotClaims } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { publicName } from './access';
import { claimSlotsLocked, isFairQueueDrop, maybeCloseDrop, releaseExpiredClaims, viewerClaimsFor, type ClaimRow } from './drops';
import { toDropView } from './views';

type EntryRow = typeof dropQueueEntries.$inferSelect;

const unixSecond = (d: Date) => Math.floor(d.getTime() / 1000);

/** Entries ahead of `entry` (same drop, QUEUED, earlier in the fair order). */
async function positionOf(entry: Pick<EntryRow, 'id' | 'dropId' | 'enqueuedSecond' | 'tieBreak'>): Promise<number> {
    const [r] = await getDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(dropQueueEntries)
        .where(
            and(
                eq(dropQueueEntries.dropId, entry.dropId),
                eq(dropQueueEntries.status, 'QUEUED'),
                sql`(${dropQueueEntries.enqueuedSecond}, ${dropQueueEntries.tieBreak}, ${dropQueueEntries.id}) < (${entry.enqueuedSecond}, ${entry.tieBreak}, ${entry.id})`,
            ),
        );
    return Number(r?.n ?? 0) + 1;
}

async function queueLength(dropId: string): Promise<number> {
    const [r] = await getDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(dropQueueEntries)
        .where(and(eq(dropQueueEntries.dropId, dropId), eq(dropQueueEntries.status, 'QUEUED')));
    return Number(r?.n ?? 0);
}

async function entryResponse(entry: EntryRow, viewerId: string): Promise<DropQueueResponse> {
    const db = getDb();
    const [drop] = await db.select().from(drops).where(eq(drops.id, entry.dropId));
    if (!drop) throw new ApiError('NOT_FOUND', 'Drop not found');
    let claim: DropQueueResponse['claim'] = null;
    if (entry.claimId) {
        const [row] = await db.select({ claim: slotClaims, payment: payments }).from(slotClaims).leftJoin(payments, eq(payments.orderId, slotClaims.orderId)).where(eq(slotClaims.id, entry.claimId));
        if (row)
            claim = {
                claimId: row.claim.id,
                orderId: row.claim.orderId,
                checkoutUrl: row.claim.checkoutUrl,
                status: row.claim.status === 'RESERVED' && row.payment?.status === 'AUTHORIZED' ? 'AUTHORIZED' : row.claim.status,
                payment: row.payment ? { provider: row.payment.provider, providerRef: row.payment.providerRef } : null,
                totalCents: row.payment?.amountCents ?? 0,
            };
    }
    const held = (await viewerClaimsFor(drop.id, viewerId, db)).held;
    return {
        entryId: entry.id,
        dropId: entry.dropId,
        status: entry.status,
        position: entry.status === 'QUEUED' ? await positionOf(entry) : null,
        queueLength: await queueLength(entry.dropId),
        quantity: entry.quantity,
        claim,
        reason: entry.reason,
        drop: toDropView(drop, held, true),
    };
}

/**
 * Admit eligible entries (arrival second < now's second) in fair order under the drop lock.
 * Returns how many were admitted / rejected. Safe to call concurrently: callers serialize on
 * the drop row.
 */
export async function processDropQueue(dropId: string, now: Date = new Date(), maxEntries = 100): Promise<{ admitted: number; rejected: number }> {
    const expired: ClaimRow[] = [];
    let title = 'the drop';
    const result = await withTx(async (tx) => {
        const [locked] = await tx.select().from(drops).where(eq(drops.id, dropId)).for('update');
        if (!locked) return { admitted: 0, rejected: 0 };
        title = locked.title;
        const entries = await tx
            .select()
            .from(dropQueueEntries)
            .where(and(eq(dropQueueEntries.dropId, dropId), eq(dropQueueEntries.status, 'QUEUED'), lt(dropQueueEntries.enqueuedSecond, unixSecond(now))))
            .orderBy(asc(dropQueueEntries.enqueuedSecond), asc(dropQueueEntries.tieBreak), asc(dropQueueEntries.id))
            .limit(maxEntries);
        let admitted = 0;
        let rejected = 0;
        for (const entry of entries) {
            const [drop] = await tx.select().from(drops).where(eq(drops.id, dropId));
            const input = ClaimSlotsRequest.parse(entry.request);
            try {
                const claim = await tx.transaction(async (sp) =>
                    claimSlotsLocked(sp, drop, { userId: entry.userId, email: entry.buyerEmail, publicName: entry.buyerName }, input, `queue:${entry.id}`, expired),
                );
                await tx.update(dropQueueEntries).set({ status: 'ADMITTED', claimId: claim.claimId, processedAt: now }).where(eq(dropQueueEntries.id, entry.id));
                admitted++;
            } catch (err) {
                if (!(err instanceof ApiError)) throw err;
                await tx.update(dropQueueEntries).set({ status: 'REJECTED', reason: err.message.slice(0, 300), processedAt: now }).where(eq(dropQueueEntries.id, entry.id));
                rejected++;
            }
        }
        if (admitted + rejected > 0) {
            await emitEvent(tx, { type: 'drop.queue_processed', payload: { dropId, admitted, rejected }, actor: { kind: 'system', id: 'live' }, correlationId: locked.showId ?? dropId, buildId: locked.buildId });
        }
        return { admitted, rejected };
    });
    if (expired.length) await releaseExpiredClaims(expired, title);
    return result;
}

/** Join the fair queue (one QUEUED entry per buyer and drop; re-joining returns the same entry). */
export async function joinDropQueue(dropId: string, viewer: ViewerContext, input: ClaimSlotsRequest, now: Date = new Date()): Promise<DropQueueResponse> {
    await maybeCloseDrop(dropId, now);
    const db = getDb();
    const [drop] = await db.select().from(drops).where(eq(drops.id, dropId));
    if (!drop) throw new ApiError('NOT_FOUND', 'Drop not found');
    if (!(await isFairQueueDrop(db, dropId))) throw new ApiError('CONFLICT', 'This drop takes claims directly; there is no queue.', 409, { fairQueue: false });
    if (drop.status !== 'OPEN' || drop.closesAt.getTime() <= now.getTime()) throw new ApiError('CONFLICT', 'This drop is closed.');
    const [existing] = await db
        .select()
        .from(dropQueueEntries)
        .where(and(eq(dropQueueEntries.dropId, dropId), eq(dropQueueEntries.userId, viewer.user.id), eq(dropQueueEntries.status, 'QUEUED')))
        .limit(1);
    let entry = existing;
    if (!entry) {
        const [row] = await db
            .insert(dropQueueEntries)
            .values({
                dropId,
                userId: viewer.user.id,
                buyerEmail: viewer.user.email,
                buyerName: publicName(viewer),
                quantity: input.quantity,
                request: input as unknown as Record<string, unknown>,
                enqueuedSecond: unixSecond(now),
                tieBreak: randomInt(0, 2 ** 31 - 1),
                createdAt: now,
            })
            .onConflictDoNothing()
            .returning();
        entry = row ?? (await db.select().from(dropQueueEntries).where(and(eq(dropQueueEntries.dropId, dropId), eq(dropQueueEntries.userId, viewer.user.id), eq(dropQueueEntries.status, 'QUEUED'))).limit(1))[0];
    }
    if (!entry) throw new ApiError('CONFLICT', 'Could not join the queue. Try again.');
    await processDropQueue(dropId, now);
    const [fresh] = await db.select().from(dropQueueEntries).where(eq(dropQueueEntries.id, entry.id));
    return entryResponse(fresh ?? entry, viewer.user.id);
}

/** The viewer's latest entry on the drop (processing the queue first), or null. */
export async function dropQueueStatus(dropId: string, viewer: ViewerContext, now: Date = new Date()): Promise<DropQueueResponse | null> {
    await processDropQueue(dropId, now);
    const [entry] = await getDb()
        .select()
        .from(dropQueueEntries)
        .where(and(eq(dropQueueEntries.dropId, dropId), eq(dropQueueEntries.userId, viewer.user.id)))
        .orderBy(sql`${dropQueueEntries.createdAt} desc`)
        .limit(1);
    return entry ? entryResponse(entry, viewer.user.id) : null;
}

/** Sweep: drain every open fair-queue drop (called with the drop sweep). */
export async function sweepDropQueues(now: Date = new Date()): Promise<number> {
    const rows = await getDb()
        .selectDistinct({ dropId: dropQueueEntries.dropId })
        .from(dropQueueEntries)
        .where(eq(dropQueueEntries.status, 'QUEUED'));
    let n = 0;
    for (const r of rows) n += (await processDropQueue(r.dropId, now)).admitted;
    // Entries of drops that closed while queued are rejected with the reason.
    await getDb()
        .update(dropQueueEntries)
        .set({ status: 'REJECTED', reason: 'The drop closed before your turn.', processedAt: now })
        .where(and(eq(dropQueueEntries.status, 'QUEUED'), inArray(dropQueueEntries.dropId, getDb().select({ id: drops.id }).from(drops).where(sql`${drops.status} <> 'OPEN'`))));
    return n;
}
