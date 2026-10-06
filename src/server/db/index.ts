/**
 * Database client (Drizzle + postgres-js).
 *
 * - `getDb()` returns a process-wide singleton built from DATABASE_URL (cached on
 *   globalThis so Next dev hot reloads don't leak connections).
 * - Server code must call `getDb()` at CALL time, never at module load, so tests
 *   can swap the database with `setDb()` (see `createTestDb()` in ./test-db.ts).
 * - Functions that participate in a caller's transaction take an optional
 *   `tx?: DbOrTx` parameter and fall back to `getDb()`.
 *
 * Use relative imports only in src/server/db/*: these files also run under bun
 * scripts and drizzle-kit.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };

export type Db = PostgresJsDatabase<typeof schema>;
/** A transaction handle as passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either the root client or a transaction: accept this in functions that can join a caller's transaction. */
export type DbOrTx = Db | Tx;

export const DEFAULT_DATABASE_URL = 'postgresql://dm:dm@localhost:5432/discovermake';

type DbHandle = { db: Db; client: postgres.Sql; url: string };

const globalForDb = globalThis as unknown as { __dmDb?: DbHandle; __dmDbOverride?: Db | null };

/** Create a new, independent client. Callers own `client.end()`. */
export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
    const client = postgres(url, {
        max: opts.max ?? 10,
        idle_timeout: 20,
        connect_timeout: 10,
        // Quiet "NOTICE: ... already exists" noise from migrations.
        onnotice: () => {},
    });
    const db = drizzle(client, { schema, casing: 'snake_case' });
    return { db, client, url };
}

/** The process-wide database. Honors `setDb()` overrides (tests). */
export function getDb(): Db {
    if (globalForDb.__dmDbOverride) return globalForDb.__dmDbOverride;
    if (!globalForDb.__dmDb) {
        globalForDb.__dmDb = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
    }
    return globalForDb.__dmDb.db;
}

/** Test hook: route every `getDb()` call to `db` (pass null to clear). */
export function setDb(db: Db | null): void {
    globalForDb.__dmDbOverride = db;
}

/** Close the singleton client (scripts). */
export async function closeDb(): Promise<void> {
    if (globalForDb.__dmDb) {
        await globalForDb.__dmDb.client.end({ timeout: 5 });
        globalForDb.__dmDb = undefined;
    }
}

/**
 * Run `fn` inside a transaction. If `tx` is already a transaction, `fn` joins it
 * (drizzle opens a savepoint for nested `transaction()` calls).
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, tx?: DbOrTx): Promise<T> {
    const target = tx ?? getDb();
    return target.transaction(fn);
}
