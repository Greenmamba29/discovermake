/**
 * Workspace view model: sections only for real data, open questions, Make AI confidence,
 * next action and approval rules.
 */
import { describe, expect, it } from 'vitest';
import { availableSections, canApprove, confidenceSummary, materialsOf, nextAction, openUnknowns, partsOf, requirementInfo } from './workspace-model';
import { makeView } from './workspace.fixtures';

describe('workspace model', () => {
    it('lists only sections backed by nodes in the version', () => {
        expect(availableSections(makeView())).toEqual(['overview', 'requirements', 'questions', 'materials', 'parts', 'graph', 'versions']);
        const bare = makeView({ nodes: [makeView().nodes[0]!], edges: [] });
        expect(availableSections(bare)).toEqual(['overview', 'graph', 'versions']);
    });

    it('reads questions, requirements, materials and parts from node data', () => {
        const view = makeView();
        expect(openUnknowns(view).map((u) => [u.key, u.suggestedDefault])).toEqual([
            ['unk:U1', null],
            ['unk:U2', '1'],
        ]);
        expect(requirementInfo(view.nodes.find((n) => n.key === 'req:R2')!)).toMatchObject({ statedByBuyer: false, category: 'finish', confidence: 0.5 });
        expect(materialsOf(view).map((m) => [m.key, m.role, m.inCatalog])).toEqual([
            ['mat:aluminum-5052', 'recommended', true],
            ['mat:src-polycarbonate', 'alternative', false],
        ]);
        expect(partsOf(view)).toEqual([
            {
                key: 'part:main',
                label: 'Outdoor electronics enclosure · main part',
                type: 'PART',
                dimensions: [],
                dimensionsStated: false,
                materials: ['Aluminum 5052-H32', 'Polycarbonate (needs sourcing)'],
                processes: ['Fiber laser cutting'],
                finishes: [],
            },
        ]);
    });

    it('summarizes Make AI confidence over AI nodes only', () => {
        const c = confidenceSummary(makeView());
        expect(c.count).toBe(3);
        expect(c.average).toBeCloseTo((0.9 + 0.5 + 0.7) / 3);
        expect(c.lowest).toEqual({ label: 'Black powder coat', confidence: 0.5 });
    });

    it('next action: answer questions, then approve, then get a binding price', () => {
        expect(nextAction(makeView())).toMatchObject({ title: 'Answer 2 questions', section: 'questions' });
        const answered = makeView({ nodes: makeView().nodes.filter((n) => n.type !== 'UNKNOWN') });
        expect(nextAction(answered)).toMatchObject({ title: 'Approve version 1', section: 'versions' });
        const approved = makeView({ nodes: answered.nodes, versions: [{ version: 1, status: 'APPROVED', summary: 'x', createdAt: '2026-10-07T12:00:00.000Z' }] });
        expect(nextAction(approved).title).toBe('Get a binding price');
    });

    it('only a DRAFT newer than the approved version can be approved', () => {
        const T = '2026-10-07T12:00:00.000Z';
        const view = makeView({
            version: 3,
            versions: [
                { version: 1, status: 'SUPERSEDED', summary: 'a', createdAt: T },
                { version: 2, status: 'APPROVED', summary: 'b', createdAt: T },
                { version: 3, status: 'DRAFT', summary: 'c', createdAt: T },
            ],
        });
        expect([1, 2, 3, 4].map((v) => canApprove(view, v))).toEqual([false, false, true, false]);
    });
});
