import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit + integration tests (`bun run test`).
 * - Integration suites create their own throwaway Postgres database with
 *   `createTestDb()` (src/server/db/test-db.ts), so files run in parallel safely.
 * - Playwright e2e specs live in tests/e2e and are excluded here.
 */
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(root, 'src'),
            // `server-only` throws outside the react-server condition; make it a no-op in tests.
            'server-only': path.resolve(root, 'tests/support/empty-module.ts'),
        },
    },
    test: {
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
        exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
        environment: 'node',
        setupFiles: ['tests/support/setup.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000,
        pool: 'forks',
    },
});
