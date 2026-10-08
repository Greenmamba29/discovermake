/**
 * CAD agent guards: the model may choose a family and process parameters, but
 * product-defining lengths must trace to numbers the buyer supplied.
 */
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { BgNode, BuildGraphView } from '@/contracts/build-graph';
import { buyerNumbers, extractMm, guardProposal, proposeCadSpec, type CadProposal } from '@/server/cad/agent';

function node(key: string, type: BgNode['type'], label: string, source: BgNode['source'], data: Record<string, unknown> = {}): BgNode {
    return { id: `bgn_${key.replace(/\W/g, '')}`, buildId: 'bld_test1', designVersion: 2, key, type, label, data, confidence: source === 'user' ? null : 0.6, source, provenance: null };
}

function view(nodes: BgNode[]): BuildGraphView {
    return {
        build: { id: 'bld_test1', displayId: 'DM-ABCDE', name: 'Wall bracket', origin: 'make_ai', trustState: 'ENGINEERING_REVIEW', currentVersion: 2, derivedFromBuildId: null },
        version: { id: 'dv_test1', buildId: 'bld_test1', version: 2, status: 'APPROVED', summary: 'answers', parentVersion: 1, createdBy: 'buyer', approvedBy: 'buyer', approvedAt: null, createdAt: '2026-10-07T00:00:00.000Z' },
        versions: [],
        nodes,
        edges: [],
    };
}

const BRACKET_VIEW = view([
    node('build:root', 'BUILD', 'Wall bracket', 'make_ai'),
    node('req:R1', 'REQUIREMENT', 'Holds a 2 kg shelf', 'make_ai', { text: 'Holds a 2 kg shelf' }),
    node('req:A1', 'REQUIREMENT', 'Legs 50 mm and 80 mm, 40 mm wide', 'user', { text: 'Legs 50 mm and 80 mm, 40 mm wide' }),
    node('unknown:U1', 'UNKNOWN', 'Mounting hole?', 'make_ai', { status: 'answered', value: 'one 5 mm hole, 15 mm from the edge, centred at 20 mm' }),
    node('req:R9', 'REQUIREMENT', 'About 300 mm long', 'make_ai', { text: 'About 300 mm long' }),
    node('req:R2', 'REQUIREMENT', 'Arm 120 mm', 'make_ai', { text: 'Arm 120 mm', requirementSource: 'user' }),
]);

const base: CadProposal = { family: 'l_bracket', dimension_sources: [], missing_inputs: [], rationale: 'single bend bracket' };

describe('extractMm / buyerNumbers', () => {
    it('reads mm, cm and inches, including "a x b x c"', () => {
        expect(extractMm('8 x 6 in')).toEqual([203.2, 152.4]);
        expect(extractMm('a 12 cm tall box, 3mm wall')).toEqual([120, 3]);
    });
    it('only counts user-sourced requirements and answered unknowns', () => {
        const nums = buyerNumbers(BRACKET_VIEW.nodes);
        expect([...nums.keys()].sort()).toEqual(['req:A1', 'req:R2', 'unknown:U1']);
        expect(nums.get('req:A1')).toEqual([50, 80, 40]);
    });
});

describe('guardProposal', () => {
    it('accepts buyer-sourced lengths and fills process defaults', () => {
        const r = guardProposal({ ...base, leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, dimension_sources: [{ param: 'leg_a_mm', node_key: 'req:A1' }], holes_a: [{ x_mm: 20, y_mm: 15, diameter_mm: 5 }] }, BRACKET_VIEW);
        expect(r.status).toBe('ready');
        if (r.status !== 'ready') return;
        expect(r.spec).toMatchObject({ family: 'l_bracket', leg_a_mm: 50, inside_bend_radius_mm: 1.52, holes_a: [{ x_mm: 20, y_mm: 15, diameter_mm: 5 }] });
    });

    it('refuses a length that only an AI-inferred node mentions', () => {
        const r = guardProposal({ ...base, leg_a_mm: 300, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52 }, BRACKET_VIEW);
        expect(r.status).toBe('needs_input');
        if (r.status === 'needs_input') expect(r.questions[0]).toMatch(/leg a.*300 mm/);
    });

    it('only accepts lengths within 0.5 mm of a buyer number (no relative slack)', () => {
        const drift = guardProposal({ ...base, leg_a_mm: 50.4, leg_b_mm: 81, width_mm: 40, thickness_mm: 1.52 }, BRACKET_VIEW);
        expect(drift.status).toBe('needs_input');
        if (drift.status === 'needs_input') expect(drift.questions.join(' ')).toMatch(/leg b/);
    });

    it('asks for missing lengths instead of inventing them', () => {
        const r = guardProposal({ ...base, leg_a_mm: 50, thickness_mm: 1.52 }, BRACKET_VIEW);
        expect(r).toMatchObject({ status: 'needs_input' });
        if (r.status === 'needs_input') expect(r.questions.join(' ')).toMatch(/leg b/);
    });

    it('drops holes whose positions the buyer did not give', () => {
        const r = guardProposal({ ...base, leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 1.52, holes_b: [{ x_mm: 20, y_mm: 33, diameter_mm: 5 }] }, BRACKET_VIEW);
        expect(r.status).toBe('ready');
        if (r.status === 'ready') {
            expect(r.spec).toMatchObject({ holes_b: [] });
            expect(r.dropped).toHaveLength(1);
        }
    });

    it('turns out-of-range geometry into a question', () => {
        const v = view([node('req:A1', 'REQUIREMENT', 'Plate 5000 x 100 mm', 'user', { text: 'Plate 5000 x 100 mm' })]);
        const r = guardProposal({ ...base, family: 'sheet_panel', width_mm: 5000, height_mm: 100, thickness_mm: 2 }, v);
        expect(r.status).toBe('needs_input');
    });

    it('passes not_supported through', () => {
        expect(guardProposal({ ...base, family: 'not_supported', rationale: 'organic shape' }, BRACKET_VIEW)).toEqual({ status: 'not_supported', reason: 'organic shape' });
    });
});

describe('proposeCadSpec', () => {
    it('runs the model with structured output and applies the guards', async () => {
        const proposal: CadProposal = { ...base, leg_a_mm: 50, leg_b_mm: 80, width_mm: 40, thickness_mm: 2, inside_bend_radius_mm: 2 };
        let prompt = '';
        const model = new MockLanguageModelV4({
            provider: 'google.generative-ai',
            modelId: 'gemini-test-flash',
            doGenerate: async (opts) => {
                prompt = JSON.stringify(opts.prompt);
                return {
                    content: [{ type: 'text', text: JSON.stringify(proposal) }],
                    finishReason: { unified: 'stop', raw: 'STOP' },
                    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                    warnings: [],
                };
            },
        });
        const r = await proposeCadSpec(BRACKET_VIEW, { model });
        expect(prompt).toContain('req:A1');
        expect(r).toMatchObject({ status: 'ready', spec: { family: 'l_bracket', width_mm: 40 } });
    });
});
