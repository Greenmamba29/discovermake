/**
 * Make AI intake use case: CreationIntent, persisted to `make_intents`, plus the
 * `make_ai.intent_created` domain event in the same transaction.
 *
 * Every intent is persisted (refused ones too) so "Continue to Build" can turn it into a
 * Build later. The row and the event carry the intent, its classification and counts plus
 * the prompt's length and sha256 (to spot duplicates and abuse). Neither stores the raw
 * description, the IP or any other request metadata.
 *
 * `intentId` is the `make_intents.id`. The frozen MakeAiIntakeResponse contract types it as
 * a UUID, so intake rows use a UUIDv7 id instead of the `mki_` prefix (see the R2 report).
 */
import { createHash } from 'node:crypto';
import type { MakeAiIntakeResponse } from '../../contracts/make-ai';
import { getDb } from '../db';
import { makeIntents } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { uuidv7 } from '../ids';
import { createIntent, type CreateIntentOptions } from './intent';

/** Anonymous buyer: Make AI intake needs no account. */
const ANONYMOUS_BUYER = { kind: 'buyer', id: 'anonymous' } as const;

export async function runIntake(text: string, opts: CreateIntentOptions = {}): Promise<MakeAiIntakeResponse> {
    const { intent, modelId } = await createIntent(text, opts);
    const intentId = uuidv7();
    const trimmed = text.trim();
    const promptSha256 = createHash('sha256').update(trimmed).digest('hex');

    await getDb().transaction(async (tx) => {
        await tx.insert(makeIntents).values({ id: intentId, intent, model: modelId, promptSha256, promptChars: trimmed.length });
        await emitEvent(tx, {
            type: 'make_ai.intent_created',
            actor: ANONYMOUS_BUYER,
            correlationId: intentId,
            payload: {
                intentId,
                intent: intent.intent,
                riskClass: intent.risk_class,
                productType: intent.product_type,
                requirementCount: intent.requirements.length,
                unknownCount: intent.unknowns.length,
                refused: Boolean(intent.refusal_note),
                model: modelId,
                promptChars: trimmed.length,
                promptSha256,
            },
        });
    });

    return { intentId, intent, model: modelId, estimateOnly: true };
}
