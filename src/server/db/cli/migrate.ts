/** CLI: `bun run db:migrate` — apply migrations to DATABASE_URL. */
import { DEFAULT_DATABASE_URL } from '../index';
import { migrateDatabase, redactUrl } from '../migrate';

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
migrateDatabase(url)
    .then(() => {
        console.log(`[db:migrate] migrations applied to ${redactUrl(url)}`);
        process.exit(0);
    })
    .catch((err) => {
        console.error('[db:migrate] failed:', err);
        process.exit(1);
    });
