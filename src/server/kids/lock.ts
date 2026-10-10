/**
 * Kids mode session lock (kid_mode_locks): while a grown-up's session is handed to a kid, that
 * session is not a grown-up session anywhere on the server (getViewer answers null), so even a
 * removed `dm_kid` cookie never reopens the grown-up's account, saved details or checkout.
 *
 * Dependency-light on purpose (db + schema only): src/server/auth/viewer.ts imports it.
 */
import { eq } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db';
import { kidModeLocks } from '../db/schema';

export type KidModeLock = typeof kidModeLocks.$inferSelect;

export async function findSessionLock(sessionId: string, db: DbOrTx = getDb()): Promise<KidModeLock | null> {
    const [row] = await db.select().from(kidModeLocks).where(eq(kidModeLocks.sessionId, sessionId)).limit(1);
    return row ?? null;
}

export async function lockSession(input: { sessionId: string; ownerUserId: string; kidId: string }, db: DbOrTx = getDb()): Promise<void> {
    await db
        .insert(kidModeLocks)
        .values(input)
        .onConflictDoUpdate({ target: kidModeLocks.sessionId, set: { kidId: input.kidId, ownerUserId: input.ownerUserId, createdAt: new Date() } });
}

export async function unlockSession(sessionId: string, db: DbOrTx = getDb()): Promise<void> {
    await db.delete(kidModeLocks).where(eq(kidModeLocks.sessionId, sessionId));
}
