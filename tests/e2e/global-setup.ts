/**
 * Playwright global setup: recreate the dedicated e2e database from scratch
 * (it only ever holds e2e data), apply migrations and run the seed with the
 * deterministic e2e Shop Console token. Refuses to touch any database whose
 * name does not end in `_e2e` so a misconfigured E2E_DATABASE_URL cannot wipe
 * a real database. Set E2E_KEEP_DB=1 to reuse the existing database instead.
 */
import postgres from 'postgres';
import { E2E_DATABASE_URL, E2E_SHOP_TOKEN } from '../../playwright.config';
import { createDb } from '../../src/server/db';
import { migrateDatabase } from '../../src/server/db/migrate';
import { seed } from '../../src/server/db/seed';

export default async function globalSetup(): Promise<void> {
    const url = new URL(E2E_DATABASE_URL);
    const dbName = url.pathname.replace(/^\//, '');
    const adminUrl = new URL(E2E_DATABASE_URL);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    try {
        if (!/_e2e$/.test(dbName)) throw new Error(`Refusing to reset "${dbName}": the e2e database name must end in _e2e`);
        const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
        if (exists.length > 0 && !process.env.E2E_KEEP_DB) {
            await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
        }
        if (exists.length === 0 || !process.env.E2E_KEEP_DB) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    } finally {
        await admin.end({ timeout: 5 });
    }
    await migrateDatabase(E2E_DATABASE_URL);
    const { db, client } = createDb(E2E_DATABASE_URL, { max: 1 });
    try {
        await seed(db, { shopToken: E2E_SHOP_TOKEN });
    } finally {
        await client.end({ timeout: 5 });
    }
}
