/**
 * Build rows for graph builds (Make AI, remix, clone): display-id allocation, guarded
 * status updates and the guest actor used until R2 accounts exist (ADR-0008).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { UniversalStatus } from '../../contracts/enums';
import type { DbOrTx } from '../db';
import { builds } from '../db/schema';
import { newBuildDisplayId } from '../ids';

export type BuildRow = typeof builds.$inferSelect;

/** Same guest actor shape as the R1 quote engine: builds are addressed by unguessable ids. */
export const guestActor = (buildId: string): Actor => ({ kind: 'buyer', id: `guest:${buildId}` });

/** Statuses a graph write may move a build between; order lifecycle states are never downgraded. */
const PRE_ORDER_STATUSES: UniversalStatus[] = ['DRAFT', 'ANALYZING', 'NEEDS_INPUT', 'READY', 'REVIEW', 'FAILED'];

export async function setGraphBuildStatus(tx: DbOrTx, buildId: string, status: UniversalStatus): Promise<void> {
    await tx
        .update(builds)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(builds.id, buildId), inArray(builds.status, PRE_ORDER_STATUSES)));
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
    const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown; message?: string } | null;
    if (!e) return false;
    if (e.code === '23505' && (e.constraint_name === constraint || e.constraint === constraint || String(e.message ?? '').includes(constraint))) return true;
    return e.cause ? isUniqueViolation(e.cause, constraint) : false;
}

/**
 * Run `fn` with a fresh `DM-XXXXX` display id, retrying (up to 6 attempts) when the
 * id collides. `fn` must run its own transaction: a unique violation aborts it.
 */
export async function withDisplayId<T>(fn: (displayId: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn(newBuildDisplayId());
        } catch (err) {
            if (attempt < 5 && isUniqueViolation(err, 'builds_display_id_uq')) continue;
            throw err;
        }
    }
}

/** Load a build, optionally locking it (FOR UPDATE) for the rest of the transaction. */
export async function loadBuild(tx: DbOrTx, buildId: string, opts: { lock?: boolean } = {}): Promise<BuildRow | null> {
    const q = tx.select().from(builds).where(eq(builds.id, buildId));
    const [row] = opts.lock ? await q.for('update') : await q;
    return row ?? null;
}
