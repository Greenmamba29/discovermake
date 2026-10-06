/**
 * Make AI intake use case: CreationIntent + `make_ai.intent_created` domain event.
 *
 * The event carries the intent's classification and counts plus the prompt's length
 * and sha256 (to spot duplicates and abuse). It never stores the raw description,
 * the IP or any other request metadata.
 */
import { createHash } from 'node:crypto';
import type { MakeAiIntakeResponse } from '../../contracts/make-ai';
import { getDb } from '../db';
import { emitEvent } from '../events/outbox';
import { uuidv7 } from '../ids';
import { createIntent, type CreateIntentOptions } from './intent';

/** Anonymous buyer: Make AI intake needs no account. */
const ANONYMOUS_BUYER = { kind: 'buyer', id: 'anonymous' } as const;

export async function runIntake(text: string, opts: CreateIntentOptions = {}): Promise<MakeAiIntakeResponse> {
    const { intent, modelId } = await createIntent(text, opts);
    const intentId = uuidv7();
    const trimmed = text.trim();

    await getDb().transaction(async (tx) => {
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
                promptSha256: createHash('sha256').update(trimmed).digest('hex'),
            },
        });
    });

    return { intentId, intent, model: modelId, estimateOnly: true };
}
