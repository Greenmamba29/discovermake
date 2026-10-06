/**
 * Apply SQL migrations from database/migrations.
 *
 *   bun run db:migrate                 # CLI: src/server/db/cli/migrate.ts (uses DATABASE_URL)
 *   import { migrateDatabase } ...     # programmatic (tests, e2e global setup)
 */
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, DEFAULT_DATABASE_URL } from './index';

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'database/migrations');

export async function migrateDatabase(url: string): Promise<void> {
    const { db, client } = createDb(url, { max: 1 });
    try {
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
        await client.end({ timeout: 5 });
    }
}

/** Hide the password when logging a connection string. */
export function redactUrl(url: string): string {
    return url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}
