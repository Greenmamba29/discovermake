import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (`bun run test:e2e`). Runs `next dev` on port 3100 against a
 * dedicated e2e database (migrated + seeded in tests/e2e/global-setup.ts) with
 * the explicit test doubles enabled: PAYMENT_PROVIDER=dev, CARRIER=manual,
 * STORAGE_DRIVER=local. These doubles refuse to run when NODE_ENV=production.
 */
export const E2E_PORT = Number(process.env.E2E_PORT || 3100);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgresql://dm:dm@localhost:5432/discovermake_e2e';
export const E2E_SHOP_TOKEN = process.env.E2E_SHOP_TOKEN || 'dmshop_e2e_console_token_do_not_use_in_prod_000';
export const E2E_ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN || 'e2e-admin-token';

export const E2E_ENV: Record<string, string> = {
    NODE_ENV: 'development',
    APP_URL: E2E_BASE_URL,
    DATABASE_URL: E2E_DATABASE_URL,
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: '.data/e2e-storage',
    STORAGE_SIGNING_SECRET: 'e2e-storage-secret',
    PAYMENT_PROVIDER: 'dev',
    CARRIER: 'manual',
    ORDER_LINK_SECRET: 'e2e-order-link-secret',
    PASSPORT_SIGNING_SECRET: 'e2e-passport-secret',
    JOB_PACKET_SIGNING_SECRET: 'e2e-job-packet-secret',
    ADMIN_TOKEN: E2E_ADMIN_TOKEN,
    SEED_SHOP_TOKEN: E2E_SHOP_TOKEN,
    // Make AI routes on, with no model key: builds are created from stored intents and the
    // Materials Engineer is skipped (it never blocks build creation).
    MAKE_AI_ENABLED: 'true',
    NEXT_PUBLIC_MAKE_AI_ENABLED: 'true',
};

/**
 * Chromium to launch. Order: PLAYWRIGHT_CHROMIUM_EXECUTABLE, then the build pinned
 * by @playwright/test (if `playwright install` has been run), then the
 * preinstalled sandbox Chromium at /opt/pw-browsers/chromium.
 */
function chromiumExecutable(): string | undefined {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    try {
        if (existsSync(chromium.executablePath())) return undefined;
    } catch {
        // fall through to the preinstalled build
    }
    return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}
const CHROMIUM_EXECUTABLE = chromiumExecutable();

/** Buyer journeys that must also pass on emulated phones (touch, mobile UA, small viewport). */
const MOBILE_JOURNEYS = /(smoke|order-journey|accounts-journey|reconstruct-journey|live-journey|mobile-touch)\.spec\.ts/;

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: /.*\.spec\.ts/,
    globalSetup: './tests/e2e/global-setup.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 120_000,
    expect: { timeout: 10_000 },
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: E2E_BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Sandboxes without the pinned browser build fall back to a preinstalled Chromium.
                launchOptions: CHROMIUM_EXECUTABLE ? { executablePath: CHROMIUM_EXECUTABLE } : {},
            },
        },
        // Real phone emulation for the buyer journeys: touch input, mobile viewport + DPR and a
        // mobile user agent (the page sweep already covers every screen at 390 px). The iPhone
        // profile runs on Chromium here because only Chromium is installed in the sandbox.
        ...(['Pixel 7', 'iPhone 14'] as const).map((device) => ({
            name: `mobile-${device.toLowerCase().replace(/\s+/g, '-')}`,
            testMatch: MOBILE_JOURNEYS,
            use: {
                ...devices[device],
                browserName: 'chromium' as const,
                launchOptions: CHROMIUM_EXECUTABLE ? { executablePath: CHROMIUM_EXECUTABLE } : {},
            },
        })),
    ],
    webServer: {
        command: `bunx next dev -p ${E2E_PORT}`,
        url: E2E_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: E2E_ENV,
    },
});
