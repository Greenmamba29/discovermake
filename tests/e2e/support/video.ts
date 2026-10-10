/**
 * Test videos: `RECORD_VIDEO=1 bunx playwright test ...` records every journey. Fixture pages
 * are covered by the config's `use.video`; contexts a journey opens itself (a second actor, a
 * phone viewer, the shop) pass these options so they are recorded too, into the test's output
 * folder. `bun run videos:collect` gathers and converts them afterwards.
 */
import { test, type BrowserContextOptions } from '@playwright/test';

export const RECORD_VIDEO = !!process.env.RECORD_VIDEO;

export function videoOptions(viewport?: { width: number; height: number } | null): BrowserContextOptions {
    if (!RECORD_VIDEO) return {};
    return { recordVideo: { dir: test.info().outputDir, size: viewport ?? { width: 1280, height: 720 } } };
}
