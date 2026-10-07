/**
 * Throwaway databases for tests. Each call creates a uniquely named database on
 * the server behind DATABASE_URL (role must be allowed to CREATE DATABASE),
 * applies all migrations, optionally seeds the R1 catalog, and returns a client.
 *
 *   const t = await createTestDb({ seed: true });
 *   setDb(t.db);                 // route getDb() to it
 *   ...
 *   setDb(null); await t.drop();
 *
 * Parallel suites never collide because every database name is unique.
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, DEFAULT_DATABASE_URL, type Db } from './index';
import { migrateDatabase } from './migrate';
import { seed, type SeedOptions, type SeedResult } from './seed';

export type TestDb = {
    db: Db;
    url: string;
    name: string;
    /** Present when created with `seed: true`. */
    seeded: SeedResult | null;
    drop: () => Promise<void>;
};

export type CreateTestDbOptions = {
    /** Seed the R1 catalog + dev shop. Default false. */
    seed?: boolean | SeedOptions;
    /** Base server URL; defaults to DATABASE_URL. */
    baseUrl?: string;
};

function withDatabase(url: string, database: string): string {
    const u = new URL(url);
    u.pathname = `/${database}`;
    return u.toString();
}

export async function createTestDb(opts: CreateTestDbOptions = {}): Promise<TestDb> {
    const baseUrl = opts.baseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
    const name = `dm_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    const admin = postgres(withDatabase(baseUrl, 'postgres'), { max: 1, onnotice: () => {} });
    try {
        await admin.unsafe(`CREATE DATABASE "${name}"`);
    } finally {
        await admin.end({ timeout: 5 });
    }

    const url = withDatabase(baseUrl, name);
    await migrateDatabase(url);
    const { db, client } = createDb(url, { max: 5 });

    let seeded: SeedResult | null = null;
    if (opts.seed) {
        seeded = await seed(db, typeof opts.seed === 'object' ? opts.seed : {});
    }

    let dropped = false;
    const drop = async () => {
        if (dropped) return;
        dropped = true;
        await client.end({ timeout: 5 });
        const a = postgres(withDatabase(baseUrl, 'postgres'), { max: 1, onnotice: () => {} });
        try {
            await a.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        } finally {
            await a.end({ timeout: 5 });
        }
    };

    return { db, url, name, seeded, drop };
}
