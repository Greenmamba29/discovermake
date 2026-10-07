/**
 * "Continue to Build": a persisted Make AI intent becomes a Build with a version 1 Build Graph.
 *
 *   createBuildFromIntent(intentId)
 *     - refused (regulated / refusal note) intents cannot become builds (403);
 *     - idempotent per intent: a second call returns the build the first one created;
 *     - runs the Materials Engineer first (outside the transaction, best effort, never blocks);
 *     - one transaction: builds row (origin make_ai, status NEEDS_INPUT when there are open
 *       questions, else DRAFT), make_intents.build_id + builds.intent_id, version 1 graph
 *       (`graphFromIntent`), and the events `build.created`, `design.version_created`,
 *       `requirements.generated` and (when the engineer answered) `material.recommended`.
 */
import { eq } from 'drizzle-orm';
import type { CreationIntent } from '../../contracts/make-ai';
import { guestActor, withDisplayId } from '../build-graph/builds';
import { loadBuildCatalog } from '../build-graph/catalog';
import { clip } from '../build-graph/graph';
import { graphFromIntent } from '../build-graph/intent-graph';
import { writeVersion } from '../build-graph/versions';
import { getDb, type DbOrTx } from '../db';
import { builds, makeIntents } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { runMaterialsEngineer, type MaterialsEngineerOptions } from './materials';

export type CreateBuildFromIntentResult = { buildId: string; displayId: string; created: boolean };

export function isRefusedIntent(intent: CreationIntent): boolean {
    return intent.risk_class === 'regulated' || Boolean(intent.refusal_note?.trim());
}

function buildName(intent: CreationIntent): string {
    const t = intent.product_type.trim();
    return clip(t.charAt(0).toUpperCase() + t.slice(1), 120);
}

async function existingBuild(db: DbOrTx, buildId: string): Promise<CreateBuildFromIntentResult> {
    const [row] = await db.select({ id: builds.id, displayId: builds.displayId }).from(builds).where(eq(builds.id, buildId));
    if (!row) throw new ApiError('INTERNAL', 'Intent points at a missing build', 500);
    return { buildId: row.id, displayId: row.displayId, created: false };
}

export async function createBuildFromIntent(intentId: string, opts: MaterialsEngineerOptions & { db?: DbOrTx } = {}): Promise<CreateBuildFromIntentResult> {
    const db = opts.db ?? getDb();
    const [row] = await db.select().from(makeIntents).where(eq(makeIntents.id, intentId));
    if (!row) throw new ApiError('NOT_FOUND', 'Make AI plan not found');
    if (isRefusedIntent(row.intent)) throw new ApiError('FORBIDDEN', 'DiscoverMake does not make this kind of item, so it cannot become a build.', 403);
    if (row.buildId) return existingBuild(db, row.buildId);

    const catalog = await loadBuildCatalog(db);
    const advice = await runMaterialsEngineer(row.intent, catalog, { model: opts.model, abortSignal: opts.abortSignal });

    return withDisplayId((displayId) =>
        db.transaction(async (tx) => {
            // Idempotency under concurrency: the second caller waits here, then sees build_id.
            const [locked] = await tx.select().from(makeIntents).where(eq(makeIntents.id, intentId)).for('update');
            if (!locked) throw new ApiError('NOT_FOUND', 'Make AI plan not found');
            if (locked.buildId) return existingBuild(tx, locked.buildId);

            const intent = locked.intent;
            const buildId = newId('build');
            const actor = guestActor(buildId);
            const name = buildName(intent);
            const graph = graphFromIntent({ intent, intentId, model: locked.model, name, displayId, catalog, advice });

            await tx.insert(builds).values({
                id: buildId,
                displayId,
                name,
                status: graph.unknownCount > 0 ? 'NEEDS_INPUT' : 'DRAFT',
                origin: 'make_ai',
                intentId,
                currentVersion: 1,
            });
            await tx.update(makeIntents).set({ buildId }).where(eq(makeIntents.id, intentId));
            await emitEvent(tx, { type: 'build.created', payload: { buildId, displayId, name }, actor, correlationId: intentId, buildId });
            const version = await writeVersion(tx, buildId, { parentVersion: null, summary: 'Drafted by Make AI from your description', nodes: graph.nodes, edges: graph.edges, actor, correlationId: intentId });
            await emitEvent(tx, {
                type: 'requirements.generated',
                payload: { buildId, version: version.version, requirementCount: graph.requirementCount, unknownCount: graph.unknownCount },
                actor,
                correlationId: intentId,
                buildId,
            });
            if (graph.recommended) {
                await emitEvent(tx, {
                    type: 'material.recommended',
                    payload: { buildId, version: version.version, material: clip(graph.recommended.label, 120), confidence: graph.recommended.confidence },
                    actor,
                    correlationId: intentId,
                    buildId,
                });
            }
            return { buildId, displayId, created: true };
        }),
    );
}
