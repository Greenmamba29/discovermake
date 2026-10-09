/**
 * Apply SQL migrations from database/migrations.
 *
 *   bun run db:migrate                 # CLI: src/server/db/cli/migrate.ts (uses DATABASE_URL)
 *   import { migrateDatabase } ...     # programmatic (tests, e2e global setup)
 *
 * 1. drizzle-kit migrations (database/migrations/*.sql + meta/_journal.json), once each;
 * 2. hand-written SQL in database/migrations/manual/*.sql (triggers and functions drizzle-kit
 *    cannot express), in file-name order, on EVERY run: each file must be idempotent
 *    (CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS ...).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, DEFAULT_DATABASE_URL } from './index';

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'database/migrations');
export const MANUAL_MIGRATIONS_FOLDER = path.join(MIGRATIONS_FOLDER, 'manual');

/** The idempotent hand-written migrations, in apply order. */
export function manualMigrationFiles(dir: string = MANUAL_MIGRATIONS_FOLDER): string[] {
    try {
        return readdirSync(dir)
            .filter((f) => f.endsWith('.sql'))
            .sort()
            .map((f) => path.join(dir, f));
    } catch {
        return [];
    }
}

export async function migrateDatabase(url: string): Promise<void> {
    const { db, client } = createDb(url, { max: 1 });
    try {
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
        for (const file of manualMigrationFiles()) {
            // Simple query protocol: a file holds several statements and $$-quoted bodies.
            await client.unsafe(readFileSync(file, 'utf8')).simple();
        }
    } finally {
        await client.end({ timeout: 5 });
    }
}

/** Hide the password when logging a connection string. */
export function redactUrl(url: string): string {
    return url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}
