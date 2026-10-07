import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/server/db/schema.ts',
    out: './database/migrations',
    casing: 'snake_case',
    dbCredentials: {
        url: process.env.DATABASE_URL || 'postgresql://dm:dm@localhost:5432/discovermake',
    },
    strict: true,
    verbose: true,
});
