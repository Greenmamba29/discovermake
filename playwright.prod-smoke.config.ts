/**
 * Production smoke (tests/prod-smoke): read-mostly checks against a running production build.
 *   PROD_SMOKE_URL=https://discovermake.com bunx playwright test -c playwright.prod-smoke.config.ts
 * Defaults to a local `next start` on :3200. Creates at most one guest part and quote.
 */
import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
    testDir: './tests/prod-smoke',
    testMatch: /.*\.smoke\.ts/,
    outputDir: 'test-results/prod-smoke',
    timeout: 120_000,
    workers: 1,
    reporter: 'line',
    use: {
        baseURL: process.env.PROD_SMOKE_URL || 'http://localhost:3200',
        launchOptions: existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    },
});
