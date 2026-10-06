/**
 * Helper for integration suites:
 *
 *   const ctx = useTestDb({ seed: true });
 *   it('...', async () => { await ctx.db.select()... });
 *
 * Creates a fresh migrated (+ optionally seeded) database for the file, routes
 * `getDb()` to it, and drops it afterwards.
 */
import { afterAll, beforeAll } from 'vitest';
import { setDb, type Db } from '@/server/db';
import { createTestDb, type CreateTestDbOptions, type TestDb } from '@/server/db/test-db';
import { resetEnvCache } from '@/server/env';

export function useTestDb(opts: CreateTestDbOptions = {}) {
    const ctx = {} as { db: Db; testDb: TestDb };
    beforeAll(async () => {
        resetEnvCache();
        ctx.testDb = await createTestDb(opts);
        ctx.db = ctx.testDb.db;
        setDb(ctx.db);
    });
    afterAll(async () => {
        setDb(null);
        await ctx.testDb?.drop();
    });
    return ctx;
}
