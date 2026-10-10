/**
 * Onboarding tours (tests/tours): narrated walk-throughs of each feature, recorded as videos.
 * Same app server, database setup and browser as the e2e suite, with slow motion so the
 * recordings are watchable.
 *
 *   bun run videos:tours      # records videos/raw/onboarding/*.webm
 *   bun run videos:collect    # converts every recording to MP4 under videos/
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const chromium = base.projects![0];

export default defineConfig({
    ...base,
    testDir: './tests/tours',
    testMatch: /.*\.tour\.ts/,
    // Own output folder: never wipes a recorded test run's results.
    outputDir: 'test-results/tours',
    timeout: 900_000,
    expect: { timeout: 20_000 },
    retries: 0,
    reporter: 'list',
    projects: [
        {
            name: 'tours',
            use: {
                ...chromium.use,
                launchOptions: { ...(chromium.use?.launchOptions ?? {}), slowMo: 90 },
            },
        },
    ],
});
