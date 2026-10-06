/**
 * Playwright global setup: (re)create nothing destructive; ensure the e2e
 * database exists, apply migrations and run the idempotent seed with the
 * deterministic e2e Shop Console token.
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
        const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
        if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
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
