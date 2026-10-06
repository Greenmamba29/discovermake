/**
 * Writes the golden DXF fixtures to tests/quote/fixtures/dxf/.
 *   bun tests/quote/fixtures/generate.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixtures';

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dxf');

if (import.meta.url === `file://${process.argv[1]}`) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const f of FIXTURES) {
        writeFileSync(path.join(FIXTURE_DIR, `${f.name}.dxf`), f.build());
    }
    console.log(`wrote ${FIXTURES.length} fixtures to ${FIXTURE_DIR}`);
}
