/**
 * NEEDS_INPUT answers (workflow 01 rule 1): the buyer answers open UNKNOWN questions,
 * which writes a NEW design version (the answered version is never edited):
 *   - each answered UNKNOWN gets `status: "answered"` and the `answer` value;
 *   - a user-sourced REQUIREMENT (`source: user`, confidence null) is added per answer;
 *   - the build's BLOCKED_BY edge to the question becomes CONSTRAINED_BY the new requirement;
 *   - a dimension answer is also recorded on the main part's `dimensions` (the only way
 *     dimensions enter a part besides buyer-stated requirements).
 * When no open questions remain the build moves NEEDS_INPUT -> DRAFT.
 */
import { z } from 'zod';
import { BgNodeKey, type BgEdgeInput, type BgNodeInput, type BuildGraphView } from '../../contracts/build-graph';
import type { Actor } from '../../contracts/common';
import { getDb, type DbOrTx } from '../db';
import { ApiError } from '../http';
import { guestActor, loadBuild, setGraphBuildStatus } from './builds';
import { clip, isOpenUnknown, ROOT_NODE_KEY } from './graph';
import { MAIN_PART_KEY, topicCategory, unknownTopic, type UnknownTopic } from './intent-graph';
import { getGraph } from './read';
import { latestVersionRow, loadVersionGraph, toEdgeInput, toNodeInput, writeVersion } from './versions';

export const MAX_ANSWERS_PER_REQUEST = 12;

export const AnswerInput = z.object({
    unknownKey: BgNodeKey,
    value: z.string().trim().min(1, 'Type an answer.').max(200, 'Keep answers under 200 characters.'),
});
export type AnswerInput = z.infer<typeof AnswerInput>;

/** Body of POST /api/builds/:buildId/answers. */
export const AnswersRequest = z.object({ answers: z.array(AnswerInput).min(1).max(MAX_ANSWERS_PER_REQUEST) });
export type AnswersRequest = z.infer<typeof AnswersRequest>;

/** Requirement key for the answer to `unk:<name>`. */
export function answerRequirementKey(unknownKey: string, taken: ReadonlySet<string>): string {
    const name = unknownKey.slice(unknownKey.indexOf(':') + 1).slice(0, 72);
    let key = `req:ans_${name}`;
    for (let i = 2; taken.has(key); i++) key = `req:ans_${name}_${i}`;
    return key;
}

/**
 * Answer open questions on the build's latest version; returns the new version's graph.
 * @throws ApiError NOT_FOUND (build / no graph), VALIDATION_FAILED (unknown key, duplicate), CONFLICT (already answered).
 */
export async function answerUnknowns(buildId: string, answers: AnswerInput[], opts: { actor?: Actor; db?: DbOrTx } = {}): Promise<BuildGraphView> {
    const parsed = AnswersRequest.safeParse({ answers });
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'Request validation failed', 400, parsed.error.flatten());
    const actor = opts.actor ?? guestActor(buildId);
    const db = opts.db ?? getDb();

    const version = await db.transaction(async (tx) => {
        const build = await loadBuild(tx, buildId, { lock: true });
        if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
        const latest = await latestVersionRow(tx, buildId);
        if (!latest) throw new ApiError('NOT_FOUND', 'This build has no Build Graph yet');
        const graph = await loadVersionGraph(tx, buildId, latest.version);
        const nodes: BgNodeInput[] = graph.nodes.map(toNodeInput);
        let edges: BgEdgeInput[] = graph.edges.map(toEdgeInput);
        const byKey = new Map(nodes.map((n) => [n.key, n]));
        const keys = new Set(byKey.keys());
        const seen = new Set<string>();
        const root = byKey.get(ROOT_NODE_KEY) ?? nodes.find((n) => n.type === 'BUILD');
        const part = byKey.get(MAIN_PART_KEY);
        const answeredAt = new Date().toISOString();

        for (const a of parsed.data.answers) {
            if (seen.has(a.unknownKey)) throw new ApiError('VALIDATION_FAILED', `Question ${a.unknownKey} is answered twice`);
            seen.add(a.unknownKey);
            const unknown = byKey.get(a.unknownKey);
            if (!unknown || unknown.type !== 'UNKNOWN') throw new ApiError('VALIDATION_FAILED', `There is no question ${a.unknownKey} on this build`);
            if (!isOpenUnknown(unknown)) throw new ApiError('CONFLICT', `Question ${a.unknownKey} is already answered. Refresh to see the latest version.`);

            const question = typeof unknown.data.question === 'string' ? unknown.data.question : unknown.label;
            const topic: UnknownTopic = unknown.data.topic === 'dimension' || unknown.data.topic === 'quantity' || unknown.data.topic === 'other' ? unknown.data.topic : unknownTopic(question);
            const usedDefault = typeof unknown.data.suggested_default === 'string' && unknown.data.suggested_default.trim() === a.value;
            unknown.data = { ...unknown.data, status: 'answered', answer: a.value, answeredAt, usedDefault };

            const reqKey = answerRequirementKey(a.unknownKey, keys);
            keys.add(reqKey);
            nodes.push({
                key: reqKey,
                type: 'REQUIREMENT',
                label: clip(a.value, 200),
                data: { text: clip(`${question} ${a.value}`, 600), question, answer: a.value, category: topicCategory(topic), requirementSource: 'user', answers: a.unknownKey },
                confidence: null,
                source: 'user',
                provenance: a.unknownKey,
            });

            if (root) {
                edges = edges.filter((e) => !(e.type === 'BLOCKED_BY' && e.fromKey === root.key && e.toKey === a.unknownKey));
                edges.push({ type: 'CONSTRAINED_BY', fromKey: root.key, toKey: reqKey, data: { answers: a.unknownKey } });
            }
            if (topic === 'dimension' && part) {
                const dims = Array.isArray(part.data.dimensions) ? (part.data.dimensions as unknown[]) : [];
                part.data = { ...part.data, dimensions: [...dims, { text: a.value, from: reqKey }], dimensionsStatus: 'stated' };
                edges.push({ type: 'CONSTRAINED_BY', fromKey: part.key, toKey: reqKey, data: {} });
            }
        }

        const n = parsed.data.answers.length;
        const written = await writeVersion(tx, buildId, {
            parentVersion: latest.version,
            summary: `Answered ${n} Make AI question${n === 1 ? '' : 's'}`,
            nodes,
            edges,
            actor,
        });
        const stillOpen = nodes.some(isOpenUnknown);
        if (stillOpen) await setGraphBuildStatus(tx, buildId, 'NEEDS_INPUT');
        else if (build.status === 'NEEDS_INPUT') await setGraphBuildStatus(tx, buildId, 'DRAFT');
        return written.version;
    });

    const view = await getGraph(buildId, version, db);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    return view;
}
