/**
 * The "Try a sample part" DXF must go through the REAL pipeline cleanly:
 * upload -> analyze (READY, mm from $INSUNITS) -> binding, orderable quote.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { analyzePart, createPartUpload, createQuote, uploadPartBytes } from '@/server/quote';
import { useTestDb } from '../../tests/support/db';
import { sampleBracketDxf } from './sample-dxf';

describe('sample mounting plate DXF', () => {
    useTestDb({ seed: true });
    let storageDir = '';

    beforeAll(async () => {
        storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-sample-'));
        setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
    });
    afterAll(async () => {
        setStorage(null);
        if (storageDir) await rm(storageDir, { recursive: true, force: true });
    });

    it('analyzes as a 120 x 80 mm plate with 5 cutouts and gets a binding quote', async () => {
        const bytes = new TextEncoder().encode(sampleBracketDxf());
        const created = await createPartUpload({ filename: 'sample-mounting-plate.dxf', contentType: 'application/dxf', sizeBytes: bytes.byteLength });
        await uploadPartBytes(created.partId, bytes);
        const part = await analyzePart(created.partId, {});

        expect(part.status).toBe('READY');
        expect(part.units).toBe('mm');
        expect(part.features?.unitsFromFile).toBe(true);
        expect(part.features?.bboxWidthMm).toBeCloseTo(120, 1);
        expect(part.features?.bboxHeightMm).toBeCloseTo(80, 1);
        expect(part.features?.innerContourCount).toBe(5);
        expect(part.features?.bendCount).toBe(0);
        expect(part.preview?.outer.length).toBe(1);
        expect(part.preview?.holes.length).toBe(5);

        const quote = await createQuote({ partId: part.id, materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', finishServiceId: null, services: [], quantity: 10 });
        expect(quote.dfm.blocking).toBe(false);
        expect(quote.trustLevel).toBe('BINDING');
        expect(quote.status).toBe('READY');
        expect(quote.orderable).toBe(true);
        expect(quote.subtotalCents).toBeGreaterThan(0);
    });
});
