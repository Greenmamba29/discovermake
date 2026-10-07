/**
 * Test fixture: a contract-valid BuildGraphView shaped like a fresh Make AI build
 * (two open questions, Materials Engineer pick, a "needs sourcing" material, no approved version).
 * Used by the workspace component tests only.
 */
import { BuildGraphView, type BgEdge, type BgNode } from '@/contracts';

const BUILD_ID = 'bld_workspace0001';
const T = '2026-10-07T12:00:00.000Z';

let n = 0;
const node = (key: string, type: BgNode['type'], label: string, data: Record<string, unknown>, extra: Partial<BgNode> = {}): BgNode => ({
    id: `bgn_fixture${++n}`,
    buildId: BUILD_ID,
    designVersion: 1,
    key,
    type,
    label,
    data,
    confidence: null,
    source: 'make_ai',
    provenance: null,
    ...extra,
});
const edge = (type: BgEdge['type'], fromKey: string, toKey: string): BgEdge => ({ id: `bge_fixture${++n}`, buildId: BUILD_ID, designVersion: 1, type, fromKey, toKey, data: {} });

export function makeView(overrides: { version?: number; versions?: BuildGraphView['versions']; trust?: BuildGraphView['build']['trustState']; nodes?: BgNode[]; edges?: BgEdge[] } = {}): BuildGraphView {
    const version = overrides.version ?? 1;
    const nodes = overrides.nodes ?? [
        node('build:root', 'BUILD', 'Outdoor electronics enclosure', { displayId: 'DM-7K3QX', summary: 'A weatherproof enclosure for a Raspberry Pi.', riskClass: 'elevated', constraints: ['Must be weatherproof'], requiredSpecialists: ['Electrical engineer'] }),
        node('req:R1', 'REQUIREMENT', 'Houses a Raspberry Pi 4', { text: 'Houses a Raspberry Pi 4', category: 'function', requirementSource: 'user' }, { confidence: 0.9 }),
        node('req:R2', 'REQUIREMENT', 'Black powder coat', { text: 'Black powder coat', category: 'finish', requirementSource: 'inferred' }, { confidence: 0.5 }),
        node('unk:U1', 'UNKNOWN', 'What are the overall dimensions?', { question: 'What are the overall dimensions?', why: 'We never guess sizes.', suggested_default: null, status: 'open', topic: 'dimension' }),
        node('unk:U2', 'UNKNOWN', 'How many do you need?', { question: 'How many do you need?', why: 'Quantity changes unit cost.', suggested_default: '1', status: 'open', topic: 'quantity' }),
        node('part:main', 'PART', 'Outdoor electronics enclosure · main part', { dimensions: [], dimensionsStatus: 'needs_input' }, { source: 'system' }),
        node('mat:aluminum-5052', 'MATERIAL', 'Aluminum 5052-H32', { role: 'recommended', inCatalog: true, needsSourcing: false, why: 'Bends cleanly outdoors.', costEffect: 'similar', costNote: 'Comparable to steel.', leadTimeEffect: 'similar', suggestedBy: 'materials_engineer', tradeoffs: ['Dents more easily.'] }, { confidence: 0.7 }),
        node('mat:src-polycarbonate', 'MATERIAL', 'Polycarbonate (needs sourcing)', { role: 'alternative', inCatalog: false, needsSourcing: true, why: 'Clear window.' }),
        node('proc:fiber-laser', 'PROCESS', 'Fiber laser cutting', { inCatalog: true, needsSourcing: false }),
    ];
    const edges = overrides.edges ?? [
        edge('CONSTRAINED_BY', 'build:root', 'req:R1'),
        edge('CONSTRAINED_BY', 'build:root', 'req:R2'),
        edge('BLOCKED_BY', 'build:root', 'unk:U1'),
        edge('BLOCKED_BY', 'build:root', 'unk:U2'),
        edge('CONTAINS', 'build:root', 'part:main'),
        edge('MADE_OF', 'part:main', 'mat:aluminum-5052'),
        edge('MADE_OF', 'part:main', 'mat:src-polycarbonate'),
        edge('REQUIRES_PROCESS', 'part:main', 'proc:fiber-laser'),
    ];
    const versions = overrides.versions ?? Array.from({ length: version }, (_, i) => ({ version: i + 1, status: 'DRAFT' as const, summary: i === 0 ? 'Drafted by Make AI from your description' : `Answered question ${i}`, createdAt: T }));
    const current = versions.find((v) => v.version === version)!;
    return BuildGraphView.parse({
        build: { id: BUILD_ID, displayId: 'DM-7K3QX', name: 'Outdoor electronics enclosure', origin: 'make_ai', trustState: overrides.trust ?? 'CONCEPT', currentVersion: Math.max(...versions.map((v) => v.version)), derivedFromBuildId: null },
        version: { id: `dv_fixture${version}`, buildId: BUILD_ID, version, status: current.status, summary: current.summary, parentVersion: version > 1 ? version - 1 : null, createdBy: `buyer:guest:${BUILD_ID}`, approvedBy: null, approvedAt: null, createdAt: T },
        versions,
        nodes: nodes.map((x) => ({ ...x, designVersion: version })),
        edges: edges.map((x) => ({ ...x, designVersion: version })),
    });
}

export const FIXTURE_BUILD_ID = BUILD_ID;
