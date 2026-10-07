/**
 * Materials Engineer (spec §15) with the model mocked: structured output constrained to the
 * catalog `materials` table, "needs sourcing" for anything else, graceful skip without a key.
 */
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildCatalog } from '@/server/build-graph';
import { resetEnvCache } from '@/server/env';
import { materialRecommendationSchema, MATERIALS_ENGINEER_SYSTEM_PROMPT, normalizeRecommendation, recommendMaterials, runMaterialsEngineer, type MaterialRecommendation } from '@/server/make-ai';
import { ENCLOSURE_INTENT, materialAnswer, REGULATED_INTENT, textResult } from './fixtures';

const CATALOG: BuildCatalog = {
    materials: [
        { slug: 'aluminum-5052', name: 'Aluminum 5052-H32', category: 'METAL', description: 'Formable aluminum.' },
        { slug: 'stainless-304', name: 'Stainless steel 304 (2B)', category: 'METAL', description: 'Corrosion resistant.' },
    ],
    processes: [{ slug: 'fiber-laser', name: 'Fiber laser cutting', kind: 'FIBER_LASER', materialSlugs: ['aluminum-5052', 'stainless-304'] }],
    services: [],
};

let answer = '';
let failWith: Error | null = null;
const model = new MockLanguageModelV4({
    provider: 'google.generative-ai',
    modelId: 'gemini-test-flash',
    doGenerate: async () => {
        if (failWith) throw failWith;
        return textResult(answer);
    },
});

describe('Materials Engineer', () => {
    beforeEach(() => {
        answer = JSON.stringify(materialAnswer());
        failWith = null;
        model.doGenerateCalls.length = 0;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        resetEnvCache();
        vi.restoreAllMocks();
    });

    it('asks with the catalog in the prompt and a slug enum in the schema, then normalizes to catalog names', async () => {
        const advice = await recommendMaterials(ENCLOSURE_INTENT, CATALOG, { model });
        const call = model.doGenerateCalls[0]!;
        expect(call.prompt[0]).toMatchObject({ role: 'system', content: MATERIALS_ENGINEER_SYSTEM_PROMPT });
        expect(JSON.stringify(call.prompt)).toContain('stainless-304: Stainless steel 304 (2B)');
        expect(JSON.stringify(call.prompt)).toContain('Raspberry Pi');
        const schema = JSON.stringify(call.responseFormat);
        expect(schema).toContain('"aluminum-5052"');
        expect(schema).toContain('"needs_sourcing"');
        expect(schema).not.toContain('mild-steel-cr');

        expect(advice).toMatchObject({
            recommended: { catalogSlug: 'aluminum-5052', name: 'Aluminum 5052-H32' },
            confidence: 0.72,
            costEffect: 'similar',
            leadTimeEffect: 'similar',
            model: 'gemini-test-flash',
        });
        // Duplicate of the recommendation dropped; off-catalog alternative kept as "needs sourcing".
        expect(advice.alternatives).toEqual([
            { catalogSlug: 'stainless-304', name: 'Stainless steel 304 (2B)', why: 'Tougher outdoors.', tradeoff: 'Heavier and slower to cut.' },
            { catalogSlug: null, name: 'Polycarbonate', why: 'Transparent window.', tradeoff: 'Not stocked: needs sourcing.' },
        ]);
    });

    it('rejects a slug outside the catalog at the schema', async () => {
        answer = JSON.stringify(materialAnswer({ recommended: { catalog_slug: 'titanium-grade-5', material: 'Titanium', why: 'Light.' } }));
        await expect(recommendMaterials(ENCLOSURE_INTENT, CATALOG, { model })).rejects.toThrow();
        expect(materialRecommendationSchema(['aluminum-5052']).safeParse(JSON.parse(answer)).success).toBe(false);
        expect(await runMaterialsEngineer(ENCLOSURE_INTENT, CATALOG, { model })).toBeNull();
    });

    it('normalizeRecommendation re-checks slugs against the catalog (defence in depth)', () => {
        const rec = materialAnswer({ recommended: { catalog_slug: 'brass-260', material: 'Brass', why: 'Shiny.' } }) as MaterialRecommendation;
        const advice = normalizeRecommendation(rec, CATALOG, 'm');
        expect(advice.recommended).toEqual({ catalogSlug: null, name: 'Brass', why: 'Shiny.' });
    });

    it('skips gracefully: no API key, regulated intent, empty catalog, provider failure', async () => {
        expect(await runMaterialsEngineer(ENCLOSURE_INTENT, CATALOG)).toBeNull();
        expect(await runMaterialsEngineer(REGULATED_INTENT, CATALOG, { model })).toBeNull();
        expect(await runMaterialsEngineer(ENCLOSURE_INTENT, { ...CATALOG, materials: [] }, { model })).toBeNull();
        expect(model.doGenerateCalls).toHaveLength(0);
        failWith = new Error('quota exceeded');
        expect(await runMaterialsEngineer(ENCLOSURE_INTENT, CATALOG, { model })).toBeNull();
    });
});
