/**
 * CAD agent guards for the Stage 1 families: only buyer-stated numbers (within 0.5 mm) become
 * product-defining lengths; untraceable lengths become NEEDS_INPUT questions and untraceable
 * features (holes, slots, countersinks, floor holes, glands) are dropped, never invented.
 */
import { describe, expect, it } from 'vitest';
import type { BgNode, BuildGraphView } from '@/contracts/build-graph';
import { buildCadPrompt, guardProposal, type CadProposal } from '@/server/cad/agent';

function node(key: string, type: BgNode['type'], label: string, source: BgNode['source'], data: Record<string, unknown> = {}): BgNode {
    return { id: `bgn_${key.replace(/\W/g, '')}`, buildId: 'bld_test1', designVersion: 2, key, type, label, data, confidence: null, source, provenance: null };
}

function view(texts: string[], extra: BgNode[] = []): BuildGraphView {
    return {
        build: { id: 'bld_test1', displayId: 'DM-ABCDE', name: 'Part', origin: 'make_ai', trustState: 'ENGINEERING_REVIEW', currentVersion: 2, derivedFromBuildId: null },
        version: { id: 'dv_test1', buildId: 'bld_test1', version: 2, status: 'APPROVED', summary: 'answers', parentVersion: 1, createdBy: 'buyer', approvedBy: 'buyer', approvedAt: null, createdAt: '2026-10-07T00:00:00.000Z' },
        versions: [],
        nodes: [node('build:root', 'BUILD', 'Part', 'make_ai'), ...texts.map((t, i) => node(`req:U${i + 1}`, 'REQUIREMENT', t, 'user', { text: t })), ...extra],
        edges: [],
    };
}

const base = { dimension_sources: [], missing_inputs: [], rationale: 'r' } satisfies Partial<CadProposal>;

describe('u_channel', () => {
    const v = view(['A channel 30 mm tall flanges on a 60 mm base, 120 mm long', 'two 5 mm holes in the base at 30 mm from flange A, 30 and 90 mm along']);
    it('accepts traced flanges and keeps traced holes', () => {
        const r = guardProposal(
            { ...base, family: 'u_channel', flange_a_mm: 30, base_mm: 60, flange_b_mm: 30, length_mm: 120, thickness_mm: 1.52, flange_holes: [{ flange: 1, x_mm: 30, y_mm: 30, diameter_mm: 5 }, { flange: 1, x_mm: 90, y_mm: 30, diameter_mm: 5 }] },
            v,
        );
        expect(r).toMatchObject({ status: 'ready', spec: { family: 'u_channel', inside_bend_radius_mm: 1.52, holes: [{ flange: 1 }, { flange: 1 }] }, dropped: [] });
    });
    it('asks for an untraced flange length', () => {
        const r = guardProposal({ ...base, family: 'u_channel', flange_a_mm: 30, base_mm: 64, flange_b_mm: 30, length_mm: 120, thickness_mm: 1.52 }, v);
        expect(r.status).toBe('needs_input');
        if (r.status === 'needs_input') expect(r.questions.join(' ')).toMatch(/base.*64 mm/);
    });
});

describe('multi_bend_bracket', () => {
    const v = view(['Z bracket, flanges 25, 40 and 25 mm, 40 mm wide']);
    it('accepts a Z profile whose every flange traces', () => {
        const r = guardProposal({ ...base, family: 'multi_bend_bracket', flanges_mm: [25, 40, 25], bend_angles_deg: [90, -90], width_mm: 40, thickness_mm: 1.52 }, v);
        expect(r).toMatchObject({ status: 'ready', spec: { family: 'multi_bend_bracket', flanges_mm: [25, 40, 25], bend_angles_deg: [90, -90] } });
    });
    it('refuses an invented flange and a missing bend direction', () => {
        const invented = guardProposal({ ...base, family: 'multi_bend_bracket', flanges_mm: [25, 40, 30], bend_angles_deg: [90, -90], width_mm: 40, thickness_mm: 1.52 }, v);
        expect(invented.status).toBe('needs_input');
        if (invented.status === 'needs_input') expect(invented.questions.join(' ')).toMatch(/flange 3.*30 mm/);
        const noAngles = guardProposal({ ...base, family: 'multi_bend_bracket', flanges_mm: [25, 40, 25], width_mm: 40, thickness_mm: 1.52 }, v);
        expect(noAngles).toMatchObject({ status: 'needs_input' });
    });
});

describe('slotted_plate', () => {
    const v = view(['Plate 160 x 80 mm', 'a 40 x 8 mm slot centred at 80, 55', 'countersunk M3 (3.4 mm through, 6.5 mm head) at 60, 20']);
    it('keeps traced slots and countersinks, drops an invented one', () => {
        const r = guardProposal(
            {
                ...base,
                family: 'slotted_plate',
                width_mm: 160,
                height_mm: 80,
                thickness_mm: 3.04,
                slots: [{ x_mm: 80, y_mm: 55, length_mm: 40, width_mm: 8 }],
                countersinks: [
                    { x_mm: 60, y_mm: 20, through_diameter_mm: 3.4, head_diameter_mm: 6.5 },
                    { x_mm: 120, y_mm: 20, through_diameter_mm: 3.4, head_diameter_mm: 6.5 },
                ],
            },
            v,
        );
        expect(r.status).toBe('ready');
        if (r.status !== 'ready') return;
        expect(r.spec).toMatchObject({ slots: [{ angle_deg: 0 }], countersinks: [{ x_mm: 60, angle_deg: 90 }] });
        expect(r.dropped).toEqual(['countersink at (120, 20) d=3.4/6.5: not given by the buyer']);
    });
    it('turns a plate with every feature dropped into a question (it would be a blank)', () => {
        const r = guardProposal({ ...base, family: 'slotted_plate', width_mm: 160, height_mm: 80, thickness_mm: 3.04, holes: [{ x_mm: 13, y_mm: 17, diameter_mm: 7 }] }, v);
        expect(r.status).toBe('needs_input');
    });
});

describe('sheet_enclosure', () => {
    const answered = node('unk:U1', 'UNKNOWN', 'Inside size?', 'make_ai', { status: 'answered', answer: '180 x 120 x 70 mm inside' });
    const v = view(['Needs a 12.5 mm cable gland hole'], [answered]);
    it('accepts a cavity from an answered question and keeps the traced gland', () => {
        const r = guardProposal({ ...base, family: 'sheet_enclosure', inner_x_mm: 180, inner_y_mm: 120, inner_z_mm: 70, thickness_mm: 1.6, gland_diameter_mm: 12.5 }, v);
        expect(r).toMatchObject({ status: 'ready', spec: { family: 'sheet_enclosure', inside_bend_radius_mm: 1.6, gland_diameter_mm: 12.5, end_flange_mm: 15 }, dropped: [] });
    });
    it('drops an invented gland and floor holes instead of guessing', () => {
        const r = guardProposal(
            { ...base, family: 'sheet_enclosure', inner_x_mm: 180, inner_y_mm: 120, inner_z_mm: 70, thickness_mm: 1.6, gland_diameter_mm: 16, floor_holes: [{ x_mm: 40, y_mm: 33, diameter_mm: 2.7 }] },
            v,
        );
        expect(r.status).toBe('ready');
        if (r.status === 'ready') {
            expect(r.spec).toMatchObject({ gland_diameter_mm: null, floor_holes: [] });
            expect(r.dropped).toHaveLength(2);
        }
    });
    it('never sizes the cavity from an inferred requirement', () => {
        const inferred = view([], [node('req:R1', 'REQUIREMENT', 'Probably 200 x 150 x 80 mm', 'make_ai', { text: 'Probably 200 x 150 x 80 mm', requirementSource: 'inferred' })]);
        const r = guardProposal({ ...base, family: 'sheet_enclosure', inner_x_mm: 200, inner_y_mm: 150, inner_z_mm: 80, thickness_mm: 1.6 }, inferred);
        expect(r.status).toBe('needs_input');
        if (r.status === 'needs_input') expect(r.questions).toHaveLength(3);
    });
});

describe('buildCadPrompt', () => {
    it('lists catalog thicknesses when given', () => {
        const prompt = buildCadPrompt(view(['x']), { catalogThicknesses: ['Aluminum 5052-H32: 1.6 (bend r>=1.6) mm'] });
        expect(prompt).toContain('Catalog sheet thicknesses');
        expect(prompt).toContain('Aluminum 5052-H32');
    });
});
