/**
 * Every Discover starter that uploads a bundled DXF must go through the REAL pipeline cleanly:
 * upload -> analyze (READY, mm from $INSUNITS, bend lines on BEND) -> a binding, orderable
 * quote for the card's preset. A starter that fails here would be a placeholder.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { analyzePart, createPartUpload, createQuote, uploadPartBytes } from '@/server/quote';
import { DISCOVER_CATALOG } from '@/lib/discover-catalog';
import { useTestDb } from '../support/db';

const QUOTE_STARTERS = DISCOVER_CATALOG.flatMap((item) => (item.start.kind === 'quote' ? [{ item, start: item.start }] : []));

describe('Discover starter DXFs', () => {
    useTestDb({ seed: true });
    let storageDir = '';

    beforeAll(async () => {
        storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-discover-'));
        setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
    });
    afterAll(async () => {
        setStorage(null);
        if (storageDir) await rm(storageDir, { recursive: true, force: true });
    });

    it('has at least eight instant-quote starters', () => {
        expect(QUOTE_STARTERS.length).toBeGreaterThanOrEqual(8);
    });

    for (const { item, start } of QUOTE_STARTERS) {
        it(`${item.slug}: analyzes READY and gets a binding quote`, async () => {
            const bytes = new TextEncoder().encode(start.dxf());
            const created = await createPartUpload({ filename: start.filename, contentType: 'application/dxf', sizeBytes: bytes.byteLength });
            await uploadPartBytes(created.partId, bytes);
            const part = await analyzePart(created.partId, {});

            expect(part.status, JSON.stringify(part.dfm?.violations)).toBe('READY');
            expect(part.units).toBe('mm');
            expect(part.features?.unitsFromFile).toBe(true);
            expect(part.features?.outerContourCount).toBe(1);
            expect(part.features?.openContourCount).toBe(0);
            expect(part.features?.bendCount).toBe(start.preview.bends?.length ?? 0);

            const quote = await createQuote({ ...start.preset, partId: part.id });
            expect(quote.dfm.violations.filter((v) => v.severity === 'BLOCKING'), JSON.stringify(quote.dfm.violations)).toEqual([]);
            expect(quote.status).toBe('READY');
            expect(quote.trustLevel).toBe('BINDING');
            expect(quote.orderable).toBe(true);
            expect(quote.subtotalCents).toBeGreaterThan(0);
        });
    }
});
