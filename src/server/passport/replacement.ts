/**
 * Replacement part from a Product Passport (1000-3, workflow 09 "replacement parts").
 *
 *   createReplacementQuote(passportId, { quantity })
 *
 * Anyone holding the passport link can order the same part again: same file (verified against
 * the passport's signed file fingerprint), material, thickness, finish and operations; quantity 1
 * by default. The quote is created by the R1 quote engine (`createQuote`), so prices and trust
 * levels follow the same rules as any other quote.
 *
 * Privacy: a public passport shows no buyer data, and this path must not open any. The
 * replacement part is a COPY of the verified file on a fresh build, so the original build (its
 * graph, attachments, quotes and order) is never reachable from the replacement. Traceability
 * lives in `passport_replacements` (quote -> passport), plus a `passport.replacement_quoted` event.
 * Repeated requests reuse the passport's replacement part and only add a quote.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import type { ReplacementResponse } from '../../contracts/workspace';
import { withDisplayId } from '../build-graph/builds';
import { getDb, withTx } from '../db';
import { builds, parts, passportReplacements, quotes } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { analyzePart, createQuote, uploadPartBytes } from '../quote';
import { getStorage, storageKeys } from '../storage';
import { getPublicPassport } from './index';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export type ReplacementOptions = { quantity?: number; deviceHash?: string | null };

export async function createReplacementQuote(passportId: string, opts: ReplacementOptions = {}): Promise<ReplacementResponse> {
    const quantity = opts.quantity ?? 1;
    const passport = await getPublicPassport(passportId);
    if (!passport) throw new ApiError('NOT_FOUND', 'Passport not found');
    if (!passport.verified) throw new ApiError('CONFLICT', 'This passport does not match its signature, so it cannot be used to reorder.');
    const snap = passport.snapshot;
    const db = getDb();

    const [source] = await db.select().from(quotes).where(eq(quotes.id, snap.quoteId));
    if (!source) throw new ApiError('CONFLICT', 'The original quote for this passport is missing. Contact support to reorder.');
    const [original] = await db.select().from(parts).where(eq(parts.id, source.partId));
    if (!original) throw new ApiError('CONFLICT', 'The original part for this passport is missing. Contact support to reorder.');

    const actor: Actor = { kind: 'buyer', id: `passport:${passport.id}` };
    const partId = (await reusablePart(passport.id, snap.part.fileSha256)) ?? (await copyPart(snap, original, actor));

    const quote = await createQuote({
        partId,
        materialId: source.config.materialId,
        thicknessOptionId: source.config.thicknessOptionId,
        finishServiceId: source.config.finishServiceId ?? null,
        services: source.config.services ?? [],
        quantity,
    });

    await withTx(async (tx) => {
        await tx.insert(passportReplacements).values({
            quoteId: quote.id,
            replacementOfPassportId: passport.id,
            partId,
            buildId: quote.buildId,
            sourceQuoteId: source.id,
            quantity,
            deviceHash: opts.deviceHash ?? null,
        });
        await emitEvent(tx, {
            type: 'passport.replacement_quoted',
            payload: { passportId: passport.id, quoteId: quote.id, partId, buildId: quote.buildId, quantity },
            actor,
            correlationId: quote.buildId,
            buildId: quote.buildId,
        });
    });

    return { quoteId: quote.id, partId, url: `/parts/${partId}?from=${quote.id}`, status: quote.status, trustLevel: quote.trustLevel };
}

/** The passport's earlier replacement part, when it is still READY with the same verified bytes. */
async function reusablePart(passportId: string, fileSha256: string): Promise<string | null> {
    const [prev] = await getDb()
        .select({ partId: passportReplacements.partId, status: parts.status, sha: parts.fileSha256 })
        .from(passportReplacements)
        .innerJoin(parts, eq(parts.id, passportReplacements.partId))
        .where(eq(passportReplacements.replacementOfPassportId, passportId))
        .orderBy(desc(passportReplacements.createdAt))
        .limit(1);
    return prev && prev.status === 'READY' && prev.sha === fileSha256 ? prev.partId : null;
}

type Snapshot = NonNullable<Awaited<ReturnType<typeof getPublicPassport>>>['snapshot'];

/** Copy the passport's verified file into a new build + part and analyze it with the original units. */
async function copyPart(snap: Snapshot, original: typeof parts.$inferSelect, actor: Actor): Promise<string> {
    const buf = await getStorage().getObject(original.fileKey);
    const bytes = buf ? new Uint8Array(buf) : null;
    if (!bytes || sha256(bytes) !== snap.part.fileSha256) {
        throw new ApiError('CONFLICT', 'The exact file this passport was made from is no longer available. Contact support to reorder.');
    }

    const buildId = newId('build');
    const partId = newId('part');
    const name = `${snap.build.name} (replacement)`.slice(0, 200);
    await withDisplayId((displayId) =>
        getDb().transaction(async (tx) => {
            await tx.insert(builds).values({ id: buildId, displayId, name, status: 'DRAFT', origin: 'upload' });
            await tx.insert(parts).values({
                id: partId,
                buildId,
                fileKey: storageKeys.partSource(partId),
                filename: snap.part.filename,
                format: 'dxf',
                sizeBytes: bytes.byteLength,
                status: 'AWAITING_UPLOAD',
            });
            await emitEvent(tx, { type: 'build.created', payload: { buildId, displayId, name }, actor, correlationId: buildId, buildId });
        }),
    );
    await uploadPartBytes(partId, bytes);
    const part = await analyzePart(partId, original.units ? { units: original.units } : {});
    if (part.status !== 'READY') {
        throw new ApiError('CONFLICT', part.error ?? 'The replacement part could not be prepared for a quote. Contact support to reorder.');
    }
    return partId;
}
