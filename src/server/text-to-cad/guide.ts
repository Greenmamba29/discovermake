/**
 * The model-writing guide for "Make it in 3D": our preamble plus the vendored text-to-cad cad
 * skill docs (cadgen 0.7.20, commit b48ff49, MIT; see ./guide/README.md). Read once per process.
 * next.config.js traces ./guide into the routes that use it (outputFileTracingIncludes).
 */
import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const TEXT_TO_CAD_GUIDE_VERSION = 'cadgen-0.7.20+b48ff49/dm-1';

export const GUIDE_FILES = ['PREAMBLE.md', 'SKILL.md', 'references/build123d-modeling.md', 'references/step-generation.md', 'references/supported-exports.md'] as const;

let cached: string | null = null;

export function guideDir(): string {
    return path.join(process.cwd(), 'src', 'server', 'text-to-cad', 'guide');
}

/** The full instructions handed to the model (preamble first: it wins). */
export function loadGuide(): string {
    if (cached) return cached;
    const dir = guideDir();
    const parts = GUIDE_FILES.map((f) => `<!-- ${f} -->\n${readFileSync(path.join(dir, f), 'utf8').trim()}`);
    cached = parts.join('\n\n---\n\n');
    return cached;
}
