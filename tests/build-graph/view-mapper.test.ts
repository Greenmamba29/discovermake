/**
 * `buildGraphFromView`: persisted Build Graph -> the order page's display graph, so the
 * workspace Graph View reuses the R1 canvas. AI drafts read as drafts, open questions as
 * NEEDS_INPUT, catalog misses as REVIEW; nothing reads READY without evidence.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_GRAPH_EDGE_TYPES, BUILD_GRAPH_NODE_TYPES, buildGraphFromView, describeNode, layoutBuildGraph } from '@/lib/build-graph';
import { makeView } from '@/components/workspace/workspace.fixtures';

describe('buildGraphFromView', () => {
    it('maps every node by key with display types, columns and states', () => {
        const view = makeView();
        const g = buildGraphFromView(view);
        expect(g.nodes.map((n) => n.id)).toEqual(view.nodes.map((n) => n.key));
        expect(g.nodes.every((n) => (BUILD_GRAPH_NODE_TYPES as readonly string[]).includes(n.type))).toBe(true);
        expect(g.edges.every((e) => (BUILD_GRAPH_EDGE_TYPES as readonly string[]).includes(e.type))).toBe(true);

        const by = new Map(g.nodes.map((n) => [n.id, n]));
        expect(by.get('build:root')).toMatchObject({ type: 'Build', column: 0, status: 'DRAFT', value: 'DM-7K3QX · v1' });
        expect(by.get('req:R1')).toMatchObject({ type: 'Requirement', column: 1, state: 'pending', status: 'DRAFT', value: 'function · 90% sure' });
        expect(by.get('unk:U1')).toMatchObject({ type: 'Unknown', typeLabel: 'Question', column: 1, state: 'active', status: 'NEEDS_INPUT' });
        expect(by.get('part:main')).toMatchObject({ type: 'Part', column: 2, value: 'Dimensions needed' });
        expect(by.get('mat:aluminum-5052')).toMatchObject({ type: 'MaterialSpec', column: 3, value: 'recommended · 70% sure', status: 'DRAFT' });
        expect(by.get('mat:src-polycarbonate')).toMatchObject({ status: 'REVIEW', value: 'Needs sourcing' });
        expect(g.columns).toBe(4);
        expect(g.rows).toBe(4);
        expect(g.nodes.some((n) => n.status === 'READY' || n.status === 'COMPLETE')).toBe(false);

        expect(g.edges).toContainEqual({ id: 'BLOCKED_BY:build:root->unk:U1', type: 'BLOCKED_BY', source: 'build:root', target: 'unk:U1', state: 'active' });
        expect(layoutBuildGraph(g).size).toBe(g.nodes.length);
        expect(describeNode(by.get('unk:U1')!, g, 'Needs input')).toBe('Question: What are the overall dimensions?. Needs your answer. Status: Needs input. Linked from Outdoor electronics enclosure blocked by What are the overall dimensions?.');
    });

    it('answered questions and user requirements read as settled; the Build node follows the derived trust state', () => {
        const base = makeView();
        const nodes = base.nodes.map((n) => (n.key === 'unk:U2' ? { ...n, data: { ...n.data, status: 'answered', answer: '4' } } : n));
        nodes.push({ ...base.nodes[1]!, id: 'bgn_user', key: 'req:ans_U2', label: '4', source: 'user', confidence: null, data: { answers: 'unk:U2' } });
        const g = buildGraphFromView(makeView({ nodes, trust: 'ENGINEERING_REVIEW' }));
        const by = new Map(g.nodes.map((n) => [n.id, n]));
        expect(by.get('unk:U2')).toMatchObject({ state: 'done', status: 'COMPLETE', value: 'Answer: 4' });
        expect(by.get('req:ans_U2')).toMatchObject({ state: 'done', status: 'READY', value: 'You said' });
        expect(by.get('build:root')!.status).toBe('REVIEW');
    });
});
