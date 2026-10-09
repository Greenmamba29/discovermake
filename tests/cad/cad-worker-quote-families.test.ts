/**
 * Contract test for the Stage 1 CAD families: the golden flat patterns the worker writes
 * (`python -m cad_worker.golden`) must parse, pass DFM and quote BINDING in the R1 engine
 * with no cleanup: U-channel, hat and Z multi-bend brackets, the slotted plate (with its
 * countersinks as a secondary op) and every panel of the workflow 01 sheet enclosure.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzePart, createPartUpload, createQuote, uploadPartBytes } from '@/server/quote';
import { LocalDiskStorage, setStorage } from '@/server/storage';
import { useTestDb as withTestDb } from '../support/db';

withTestDb({ seed: true });
let storageDir = '';

beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'dm-cad-fam-'));
    setStorage(new LocalDiskStorage({ rootDir: storageDir, appUrl: 'http://localhost:3100', signingSecret: 'test-storage-secret' }));
});
afterAll(async () => {
    setStorage(null);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

const STEEL_16GA = { materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_16ga' };
const STEEL_11GA = { materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_11ga' };
const AL_063 = { materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_063' };
const BEND = [{ serviceId: 'svc_bending' }];

async function upload(rel: string) {
    const bytes = new Uint8Array(await readFile(path.join(__dirname, '../fixtures/cad', rel)));
    const created = await createPartUpload({ filename: path.basename(rel), sizeBytes: bytes.byteLength, contentType: 'application/dxf' });
    await uploadPartBytes(created.partId, bytes);
    return analyzePart(created.partId);
}

function expectBinding(quote: Awaited<ReturnType<typeof createQuote>>) {
    expect(quote.dfm.violations.filter((v) => v.severity === 'BLOCKING')).toEqual([]);
    expect(quote.trustLevel).toBe('BINDING');
    expect(quote.orderable).toBe(true);
}

describe('Stage 1 CAD families -> instant quote', () => {
    it('quotes a U-channel with both bend lines as BINDING', async () => {
        const part = await upload('cad-worker-u-channel.dxf');
        expect(part.status).toBe('READY');
        expect(part.features).toMatchObject({ bendCount: 2, bboxWidthMm: 120 });
        expect(part.features?.bendLines.map((b) => b.angleDeg)).toEqual([90, 90]);
        expect(part.features?.holes).toHaveLength(3);
        const quote = await createQuote({ partId: part.id, ...STEEL_16GA, services: BEND, quantity: 10 });
        expect(quote.lineItems.find((l) => l.code === 'BENDING')).toBeDefined();
        expectBinding(quote);
    });

    it.each(['cad-worker-hat-bracket.dxf', 'cad-worker-z-bracket.dxf'])('quotes the multi-bend bracket %s as BINDING', async (file) => {
        const part = await upload(file);
        expect(part.status).toBe('READY');
        expect(part.features?.bendCount).toBe(file.includes('hat') ? 4 : 2);
        expect(part.features?.bendLines.every((b) => b.angleDeg === 90)).toBe(true);
        expectBinding(await createQuote({ partId: part.id, ...STEEL_16GA, services: BEND, quantity: 25 }));
    });

    it('quotes the slotted plate (slots + countersinks) as BINDING with countersinking', async () => {
        const part = await upload('cad-worker-slotted-plate.dxf');
        expect(part.status).toBe('READY');
        expect(part.features?.bendCount).toBe(0);
        // 2 round holes + 2 countersink through-holes are circular; the 2 slots are not.
        expect(part.features?.holes.filter((h) => h.circular)).toHaveLength(4);
        expect(part.features?.holes.filter((h) => !h.circular)).toHaveLength(2);
        const quote = await createQuote({ partId: part.id, ...STEEL_11GA, services: [{ serviceId: 'svc_countersink', featureCount: 2 }], quantity: 10 });
        expect(quote.lineItems.find((l) => l.code === 'SECONDARY')).toBeDefined();
        expectBinding(quote);
    });

    it.each(['body_flat.dxf', 'end_cap_flat.dxf', 'end_cap_gland_flat.dxf', 'lid_flat.dxf'])('quotes the sheet-enclosure panel %s as BINDING in aluminium 5052', async (file) => {
        const part = await upload(`acceptance/${file}`);
        expect(part.status).toBe('READY');
        expect(part.features?.bendCount).toBe(2);
        expectBinding(await createQuote({ partId: part.id, ...AL_063, services: BEND, quantity: 1 }));
    });
});
