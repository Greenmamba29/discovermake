/**
 * Fixtures for Build Graph suites: Make AI intents persisted straight into `make_intents`
 * (the intake route is covered by tests/make-ai) and a mock-model result helper.
 */
import type { MockLanguageModelV4 } from 'ai/test';
import type { CreationIntent } from '@/contracts/make-ai';
import type { Db } from '@/server/db';
import { makeIntents } from '@/server/db/schema';
import { uuidv7 } from '@/server/ids';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

export function textResult(text: string): GenerateResult {
    return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'STOP' },
        usage: {
            inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 400, text: 400, reasoning: 0 },
        },
        warnings: [],
    };
}

/** The workflow 01 acceptance prompt, as `normalizeIntent` would leave it. */
export const ENCLOSURE_INTENT: CreationIntent = {
    intent: 'create',
    product_type: 'outdoor electronics enclosure',
    summary: 'A weatherproof bent-aluminum enclosure for a Raspberry Pi and a solar battery pack.',
    requirements: [
        { id: 'R1', text: 'Houses a Raspberry Pi 4 and a solar battery pack', category: 'function', source: 'user', confidence: 0.95 },
        { id: 'R2', text: 'Survives outdoor rain and sun', category: 'environment', source: 'user', confidence: 0.9 },
        { id: 'R3', text: 'Black powder-coated finish', category: 'finish', source: 'inferred', confidence: 0.55 },
    ],
    constraints: ['Must be weatherproof'],
    unknowns: [
        { question: 'What are the overall dimensions (length × width × height) and material thickness?', why_it_matters: 'Every cut depends on real measurements.' },
        { question: 'How many enclosures do you need?', why_it_matters: 'Quantity changes setup cost per unit.', suggested_default: '1' },
    ],
    materials_suggested: [
        { material: 'Aluminum 5052-H32', why: 'Bends cleanly and resists corrosion outdoors.' },
        { material: 'Polycarbonate', why: 'Transparent lid for the status LEDs.' },
    ],
    processes_suggested: ['Fiber laser cutting', 'Press brake bending', 'Powder coat', 'CNC machining'],
    risk_class: 'elevated',
    required_specialists: ['Electrical engineer'],
};

/** A bracket with a buyer-stated size and no open questions. */
export const BRACKET_INTENT: CreationIntent = {
    intent: 'create',
    product_type: 'wall shelf bracket',
    summary: 'A bent mild-steel bracket for a wall shelf.',
    requirements: [
        { id: 'R1', text: 'Holds a 20 kg shelf', category: 'function', source: 'user', confidence: 0.9 },
        { id: 'R2', text: 'Arm is 200 mm long, 3 mm thick', category: 'dimension', source: 'user', confidence: 1 },
        { id: 'R3', text: 'Four brackets', category: 'quantity', source: 'user', confidence: 1 },
    ],
    constraints: [],
    unknowns: [],
    materials_suggested: [{ material: 'Mild steel', why: 'Strong and bends well.' }],
    processes_suggested: ['Laser cutting', 'Bending'],
    risk_class: 'standard',
    required_specialists: [],
};

export const REGULATED_INTENT: CreationIntent = {
    intent: 'create',
    product_type: 'suppressor part',
    summary: 'A firearm suppressor baffle.',
    requirements: [],
    constraints: [],
    unknowns: [],
    materials_suggested: [],
    processes_suggested: [],
    risk_class: 'regulated',
    required_specialists: [],
    refusal_note: 'DiscoverMake does not make weapon parts.',
};

export async function insertIntent(db: Db, intent: CreationIntent, model = 'gemini-test-flash'): Promise<string> {
    const id = uuidv7();
    await db.insert(makeIntents).values({ id, intent, model, promptSha256: 'a'.repeat(64), promptChars: 42 });
    return id;
}

export function materialAnswer(overrides: Record<string, unknown> = {}) {
    return {
        recommended: { catalog_slug: 'aluminum-5052', material: 'Aluminium 5052', why: 'Bends cleanly and resists corrosion outdoors.' },
        alternatives: [
            { catalog_slug: 'stainless-304', material: 'Stainless 304', why: 'Tougher outdoors.', tradeoff: 'Heavier and slower to cut.' },
            { catalog_slug: 'needs_sourcing', material: 'Polycarbonate', why: 'Transparent window.', tradeoff: 'Not stocked: needs sourcing.' },
            { catalog_slug: 'aluminum-5052', material: 'Aluminum 5052-H32', why: 'Duplicate of the recommendation.', tradeoff: 'None.' },
        ],
        tradeoffs: ['Aluminum dents more easily than steel.'],
        risks: ['Powder coat must be complete at bends to stay weatherproof.'],
        process_compatibility: 'Fiber laser cutting and press brake bending.',
        cost_effect: 'similar',
        cost_note: 'Comparable to mild steel once powder coat is included.',
        lead_time_effect: 'similar',
        lead_time_note: 'Stocked by the partner shop.',
        confidence: 0.72,
        ...overrides,
    };
}
