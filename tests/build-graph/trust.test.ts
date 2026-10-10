/**
 * Build trust derivation (workflow 03): CONCEPT -> ENGINEERING_REVIEW -> MANUFACTURING_READY
 * -> SUPPLIER_CONFIRMED -> ORDERABLE, each rung backed by its own evidence row.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { answerUnknowns, approveVersion, deriveBuildTrustState } from '@/server/build-graph';
import { R1_RULESET_VERSION } from '@/server/db/seed';
import { builds, parts, sourcingJobs, supplierOffers, suppliers } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { newId } from '@/server/ids';
import { createBuildFromIntent } from '@/server/make-ai';
import { createQuoteFixture } from '../orders/fixtures';
import { useTestDb } from '../support/db';
import { ENCLOSURE_INTENT, insertIntent } from './fixtures';

describe('deriveBuildTrustState', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        resetEnvCache();
    });

    async function trust(buildId: string) {
        const [b] = await ctx.db.select().from(builds).where(eq(builds.id, buildId));
        return deriveBuildTrustState(b!);
    }

    async function addOffer(buildId: string, designVersion: number, trustLevel: 'SUPPLIER_ESTIMATE' | 'SUPPLIER_CONFIRMED', status: 'ACTIVE' | 'STALE' | 'SELECTED') {
        const jobId = newId('sourcingJob');
        await ctx.db.insert(sourcingJobs).values({ id: jobId, displayId: `SRC-${jobId.slice(-6).toUpperCase()}`, buildId, designVersion, request: {} as never, approvalPolicy: {} as never, createdBy: 'system:test' });
        const supplierId = newId('supplier');
        await ctx.db.insert(suppliers).values({ id: supplierId, name: 'Shenzhen Sheetworks', platform: 'test', country: 'CN', createdBy: 'system:test' });
        await ctx.db.insert(supplierOffers).values({
            jobId,
            supplierId,
            buildId,
            designVersion,
            idempotencyKey: newId('supplierOffer'),
            quantity: 10,
            unitPriceCents: 1250,
            moq: 10,
            productionLeadDays: 12,
            shippingLeadDays: 9,
            incoterm: 'FOB',
            material: 'Aluminum 5052-H32',
            processes: ['Fiber laser cutting'],
            confidence: 0.8,
            negotiationStatus: trustLevel === 'SUPPLIER_CONFIRMED' ? 'supplier-confirmed' : 'supplier-estimate',
            trustLevel,
            status,
            raw: {} as never,
            submittedBy: 'sourcing_agent:test',
        });
    }

    it('climbs one evidence row at a time and never skips a rung', async () => {
        const { buildId } = await createBuildFromIntent(await insertIntent(ctx.db, ENCLOSURE_INTENT));
        expect(await trust(buildId)).toBe('CONCEPT');

        // Approved but with open questions: still a concept.
        await approveVersion(buildId, 1);
        expect(await trust(buildId)).toBe('CONCEPT');

        // All questions answered on a newer DRAFT: approval is what counts.
        await answerUnknowns(buildId, [
            { unknownKey: 'unk:U1', value: '220 × 160 × 90 mm, 2 mm' },
            { unknownKey: 'unk:U2', value: '1' },
        ]);
        expect(await trust(buildId)).toBe('CONCEPT');
        await approveVersion(buildId, 2);
        expect(await trust(buildId)).toBe('ENGINEERING_REVIEW');

        // An estimate (or a stale confirmation, or one for another version) is not a confirmation.
        await addOffer(buildId, 2, 'SUPPLIER_ESTIMATE', 'ACTIVE');
        await addOffer(buildId, 2, 'SUPPLIER_CONFIRMED', 'STALE');
        await addOffer(buildId, 1, 'SUPPLIER_CONFIRMED', 'ACTIVE');
        expect(await trust(buildId)).toBe('ENGINEERING_REVIEW');

        await ctx.db.insert(parts).values({ buildId, fileKey: `parts/${buildId}/source.dxf`, filename: 'enclosure.dxf', sizeBytes: 2048, status: 'READY', units: 'mm', rulesetVersion: R1_RULESET_VERSION });
        expect(await trust(buildId)).toBe('MANUFACTURING_READY');

        await addOffer(buildId, 2, 'SUPPLIER_CONFIRMED', 'SELECTED');
        expect(await trust(buildId)).toBe('SUPPLIER_CONFIRMED');
    });

    it('ORDERABLE needs a READY, BINDING, unexpired quote for the current design', async () => {
        const fresh = await createQuoteFixture(ctx.db);
        expect(await trust(fresh.build.id)).toBe('ORDERABLE');

        const expired = await createQuoteFixture(ctx.db, { validUntil: new Date(Date.now() - 60_000) });
        expect(await trust(expired.build.id)).toBe('MANUFACTURING_READY');

        const estimate = await createQuoteFixture(ctx.db, { trustLevel: 'SUPPLIER_ESTIMATE', status: 'REVIEW' });
        expect(await trust(estimate.build.id)).toBe('MANUFACTURING_READY');
    });
});
