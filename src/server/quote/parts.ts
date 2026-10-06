/**
 * Part upload + analysis service (DB + storage). See ./index.ts for the public API.
 *
 * Storage layout:
 *   parts/<partId>/source.dxf              upload staging key (signed PUT target, direct upload)
 *   parts/<partId>/v<version>-<sha12>.dxf  immutable copy of the bytes that were analyzed;
 *                                          `parts.file_key` points here after analysis, so the
 *                                          shop always receives exactly what was quoted.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../contracts/common';
import { SYSTEM_ACTOR } from '../../contracts/common';
import type { PartUnits, UniversalStatus } from '../../contracts/enums';
import type { AnalyzePartRequest, BuildView, CreatePartRequest, CreatePartResponse, PartView } from '../../contracts/parts';
import { getDb, withTx, type DbOrTx } from '../db';
import { builds, parts, quotes } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newBuildDisplayId, newId } from '../ids';
import { getStorage, storageKeys } from '../storage';
import { analyzeDxfBytes, type DxfAnalysis } from './analyze';
import { loadActiveRuleset, loadCatalogLimits } from './catalog';
import { buildDfmResult, processFitPenalties, runGeometryDfm } from './dfm';
import { DxfParseError } from './dxf/parse';
import { assertDxfFilename, sniffDxf, UnsupportedFileError } from './dxf/sniff';

/** Upload cap for R1 part files (25 MB). The contract's 50 MB ceiling is the absolute wire limit. */
export const QUOTE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Content-Type the signed PUT is bound to (the client must send exactly `upload.headers`). */
export const DXF_CONTENT_TYPE = 'application/dxf';
export const UPLOAD_URL_TTL_SECONDS = 30 * 60;

type PartRow = typeof parts.$inferSelect;
type BuildRow = typeof builds.$inferSelect;

export const buyerActor = (buildId: string): Actor => ({ kind: 'buyer', id: `guest:${buildId}` });

/** Build statuses the quote engine may set; later lifecycle states (orders) are never downgraded. */
const PRE_ORDER_BUILD_STATUSES: UniversalStatus[] = ['DRAFT', 'ANALYZING', 'NEEDS_INPUT', 'READY', 'REVIEW', 'FAILED'];

export async function setBuildStatus(tx: DbOrTx, buildId: string, status: UniversalStatus): Promise<void> {
    await tx
        .update(builds)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(builds.id, buildId), inArray(builds.status, PRE_ORDER_BUILD_STATUSES)));
}

function filenameStem(filename: string): string {
    const base = filename.split(/[\\/]/).pop() ?? filename;
    return base.replace(/\.[^.]+$/, '').trim() || 'Untitled part';
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
    const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown; message?: string };
    if (!e) return false;
    if (e.code === '23505' && (e.constraint_name === constraint || e.constraint === constraint || String(e.message ?? '').includes(constraint))) return true;
    return e.cause ? isUniqueViolation(e.cause, constraint) : false;
}

/** True once any quote for the part was consumed by a paid order: its design is then frozen. */
export async function hasOrderedQuote(db: DbOrTx, partId: string): Promise<boolean> {
    const [row] = await db.select({ id: quotes.id }).from(quotes).where(and(eq(quotes.partId, partId), eq(quotes.status, 'ORDERED'))).limit(1);
    return Boolean(row);
}

const FROZEN_MESSAGE = 'This design is already in an order and cannot change. Upload the revised file as a new part.';

export function toUploadError(err: unknown): ApiError | null {
    if (err instanceof UnsupportedFileError) return new ApiError('UNSUPPORTED_MEDIA_TYPE', err.message, 415, { reason: err.reason });
    return null;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function partUniversalStatus(row: Pick<PartRow, 'status' | 'dfm'>): UniversalStatus {
    switch (row.status) {
        case 'AWAITING_UPLOAD':
            return 'DRAFT';
        case 'ANALYZING':
            return 'ANALYZING';
        case 'NEEDS_INPUT':
            return 'NEEDS_INPUT';
        case 'READY':
            return row.dfm?.blocking ? 'NEEDS_INPUT' : 'READY';
        case 'FAILED':
            return 'FAILED';
    }
}

export function toPartView(row: PartRow, build: Pick<BuildRow, 'displayId'>): PartView {
    return {
        id: row.id,
        buildId: row.buildId,
        buildDisplayId: build.displayId,
        filename: row.filename,
        format: 'dxf',
        sizeBytes: row.sizeBytes,
        status: row.status,
        universalStatus: partUniversalStatus(row),
        units: row.units ?? null,
        designVersion: row.designVersion,
        features: row.features ?? null,
        dfm: row.dfm ?? null,
        preview: row.preview ?? null,
        error: row.error ?? null,
        rulesetVersion: row.rulesetVersion ?? null,
        createdAt: row.createdAt.toISOString(),
        analyzedAt: row.analyzedAt ? row.analyzedAt.toISOString() : null,
    };
}

export async function loadPartWithBuild(db: DbOrTx, partId: string): Promise<{ part: PartRow; build: BuildRow } | null> {
    const [row] = await db.select({ part: parts, build: builds }).from(parts).innerJoin(builds, eq(builds.id, parts.buildId)).where(eq(parts.id, partId)).limit(1);
    return row ?? null;
}

export async function getPartView(partId: string): Promise<PartView | null> {
    const row = await loadPartWithBuild(getDb(), partId);
    return row ? toPartView(row.part, row.build) : null;
}

export async function getBuildView(buildId: string): Promise<BuildView | null> {
    const db = getDb();
    const [build] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
    if (!build) return null;
    const [part] = await db.select().from(parts).where(eq(parts.buildId, buildId)).orderBy(desc(parts.createdAt)).limit(1);
    let latestQuoteId: string | null = null;
    if (part) {
        const [q] = await db
            .select({ id: quotes.id })
            .from(quotes)
            .where(and(eq(quotes.buildId, buildId), eq(quotes.partId, part.id), eq(quotes.designVersion, part.designVersion)))
            .orderBy(desc(quotes.createdAt))
            .limit(1);
        latestQuoteId = q?.id ?? null;
    }
    return {
        id: build.id,
        displayId: build.displayId,
        name: build.name,
        status: build.status,
        part: part ? toPartView(part, build) : null,
        latestQuoteId,
        createdAt: build.createdAt.toISOString(),
        updatedAt: build.updatedAt.toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function createPartUploadImpl(input: CreatePartRequest): Promise<CreatePartResponse> {
    try {
        assertDxfFilename(input.filename);
    } catch (err) {
        throw toUploadError(err) ?? err;
    }
    if (input.sizeBytes > QUOTE_MAX_UPLOAD_BYTES) {
        throw new ApiError('PAYLOAD_TOO_LARGE', `Files up to ${QUOTE_MAX_UPLOAD_BYTES / 1024 / 1024} MB can be quoted instantly. Simplify the drawing or contact support.`);
    }
    const db = getDb();
    const buildId = newId('build');
    const partId = newId('part');
    const key = storageKeys.partSource(partId);
    const name = input.buildName?.trim() || filenameStem(input.filename);

    let displayId = '';
    for (let attempt = 0; ; attempt++) {
        displayId = newBuildDisplayId();
        try {
            await db.transaction(async (tx) => {
                await tx.insert(builds).values({ id: buildId, displayId, name, status: 'DRAFT' });
                await tx.insert(parts).values({ id: partId, buildId, fileKey: key, filename: input.filename.trim(), format: 'dxf', sizeBytes: input.sizeBytes, status: 'AWAITING_UPLOAD' });
                await emitEvent(tx, { type: 'build.created', payload: { buildId, displayId, name }, actor: buyerActor(buildId), correlationId: buildId, buildId });
            });
            break;
        } catch (err) {
            if (attempt < 5 && isUniqueViolation(err, 'builds_display_id_uq')) continue;
            throw err;
        }
    }

    const signed = await getStorage().getSignedUrl(key, { method: 'PUT', contentType: DXF_CONTENT_TYPE, maxBytes: QUOTE_MAX_UPLOAD_BYTES, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
    return {
        partId,
        buildId,
        buildDisplayId: displayId,
        upload: { url: signed.url, method: 'PUT', headers: signed.headers, key, expiresAt: signed.expiresAt.toISOString(), maxBytes: QUOTE_MAX_UPLOAD_BYTES },
    };
}

/**
 * Direct (server-side) upload of the part bytes, e.g. multipart/form-data from the
 * browser when the local storage driver is used. Same checks as the signed PUT
 * plus an immediate content sniff so the buyer gets a fast, specific error.
 */
export async function uploadPartBytesImpl(partId: string, bytes: Uint8Array): Promise<PartView> {
    const db = getDb();
    const row = await loadPartWithBuild(db, partId);
    if (!row) throw new ApiError('NOT_FOUND', 'Part not found');
    if (await hasOrderedQuote(db, partId)) throw new ApiError('CONFLICT', FROZEN_MESSAGE);
    if (bytes.byteLength > QUOTE_MAX_UPLOAD_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', `Files up to ${QUOTE_MAX_UPLOAD_BYTES / 1024 / 1024} MB can be quoted instantly.`);
    try {
        sniffDxf(bytes);
    } catch (err) {
        throw toUploadError(err) ?? err;
    }
    await getStorage().putObject(storageKeys.partSource(partId), bytes, { contentType: DXF_CONTENT_TYPE });
    const [updated] = await db
        .update(parts)
        .set({ sizeBytes: bytes.byteLength, status: row.part.status === 'FAILED' ? 'AWAITING_UPLOAD' : row.part.status, error: null, updatedAt: new Date() })
        .where(eq(parts.id, partId))
        .returning();
    return toPartView(updated, row.build);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function versionedPartKey(partId: string, designVersion: number, sha: string): string {
    return `parts/${partId}/v${designVersion}-${sha.slice(0, 12)}.dxf`;
}

export async function analyzePartImpl(partId: string, input: AnalyzePartRequest = {}): Promise<PartView> {
    const db = getDb();
    const loaded = await loadPartWithBuild(db, partId);
    if (!loaded) throw new ApiError('NOT_FOUND', 'Part not found');
    const { part } = loaded;
    const storage = getStorage();
    const stagingKey = storageKeys.partSource(partId);

    // Fall back to the immutable copy when the staging object was cleaned up.
    let key = stagingKey;
    let head = await storage.headObject(stagingKey);
    if (!head && part.fileKey !== stagingKey) {
        key = part.fileKey;
        head = await storage.headObject(part.fileKey);
    }
    if (!head) throw new ApiError('CONFLICT', 'The file has not been uploaded yet. Send the bytes to the upload URL first.');

    // Ordered designs are frozen: same bytes + units is a no-op, anything else is refused.
    if (await hasOrderedQuote(db, partId)) {
        if (input.units && input.units !== part.units) throw new ApiError('CONFLICT', FROZEN_MESSAGE);
        const current = await storage.getObject(key);
        if (current && part.fileSha256 && sha256(new Uint8Array(current)) !== part.fileSha256) throw new ApiError('CONFLICT', FROZEN_MESSAGE);
        return toPartView(part, loaded.build);
    }

    await db.update(parts).set({ status: 'ANALYZING', updatedAt: new Date() }).where(eq(parts.id, partId));
    await setBuildStatus(db, part.buildId, 'ANALYZING');

    let failure: string | null = null;
    let analysis: DxfAnalysis | null = null;
    let bytes: Uint8Array | null = null;
    if (head.sizeBytes > QUOTE_MAX_UPLOAD_BYTES) {
        failure = `The file is ${(head.sizeBytes / 1024 / 1024).toFixed(1)} MB; instant quotes accept up to ${QUOTE_MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
    } else {
        const buf = await storage.getObject(key);
        if (!buf) throw new ApiError('CONFLICT', 'The file has not been uploaded yet. Send the bytes to the upload URL first.');
        bytes = new Uint8Array(buf);
        // Keep the buyer's earlier explicit units choice on a plain re-analyze.
        const requested: PartUnits | undefined = input.units ?? (part.features && !part.features.unitsFromFile && part.units ? part.units : undefined);
        try {
            analysis = analyzeDxfBytes(bytes, { units: requested });
        } catch (err) {
            if (err instanceof UnsupportedFileError || err instanceof DxfParseError) failure = err.message;
            else {
                console.error('[quote] DXF analysis crashed', { partId, err });
                failure = 'The file could not be analyzed. Re-export it as ASCII DXF (R12–R2018) or contact support.';
            }
        }
    }

    const [ruleset, catalogLimits] = await Promise.all([loadActiveRuleset(db), loadCatalogLimits(db)]);
    const sha = bytes ? sha256(bytes) : null;
    const now = new Date();

    const updated = await withTx(async (tx) => {
        const [locked] = await tx.select().from(parts).where(eq(parts.id, partId)).for('update');
        const system: Actor = SYSTEM_ACTOR;
        const correlationId = locked.buildId;

        if (failure || !analysis || !sha || !bytes) {
            const [row] = await tx
                .update(parts)
                .set({ status: 'FAILED', error: failure ?? 'Analysis failed', features: null, dfm: null, preview: null, analyzedAt: now, sizeBytes: head.sizeBytes, updatedAt: now })
                .where(eq(parts.id, partId))
                .returning();
            await emitEvent(tx, {
                type: 'part.analyzed',
                payload: { partId, status: 'FAILED', units: null, designVersion: row.designVersion, error: row.error },
                actor: system,
                correlationId,
                buildId: locked.buildId,
            });
            await setBuildStatus(tx, locked.buildId, 'FAILED');
            return row;
        }

        const newBytes = locked.fileSha256 !== sha;
        const unitsChanged = analysis.units != null && locked.units != null && analysis.units !== locked.units;
        const bump = locked.analyzedAt != null && locked.fileSha256 != null && (newBytes || unitsChanged);
        const designVersion = bump ? locked.designVersion + 1 : locked.designVersion;

        if (newBytes) {
            await emitEvent(tx, {
                type: 'part.uploaded',
                payload: { partId, filename: locked.filename, sizeBytes: bytes.byteLength, fileSha256: sha },
                actor: buyerActor(locked.buildId),
                correlationId,
                buildId: locked.buildId,
            });
        }

        // Immutable copy of exactly the analyzed bytes.
        const fileKey = versionedPartKey(partId, designVersion, sha);
        if (locked.fileKey !== fileKey) await storage.putObject(fileKey, bytes, { contentType: DXF_CONTENT_TYPE });

        if (analysis.status === 'NEEDS_INPUT') {
            const [row] = await tx
                .update(parts)
                .set({
                    status: 'NEEDS_INPUT',
                    units: null,
                    features: null,
                    dfm: null,
                    preview: analysis.preview,
                    rulesetVersion: ruleset.version,
                    error: null,
                    fileSha256: sha,
                    fileKey,
                    sizeBytes: bytes.byteLength,
                    designVersion,
                    analyzedAt: now,
                    updatedAt: now,
                })
                .where(eq(parts.id, partId))
                .returning();
            await emitEvent(tx, {
                type: 'part.analyzed',
                payload: { partId, status: 'NEEDS_INPUT', units: null, designVersion, error: null },
                actor: system,
                correlationId,
                buildId: locked.buildId,
            });
            await setBuildStatus(tx, locked.buildId, 'NEEDS_INPUT');
            return row;
        }

        const violations = runGeometryDfm(analysis.features, {
            ruleset,
            catalogLimits,
            openEnds: analysis.geometry.openEnds.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000] as [number, number]),
        });
        const dfm = buildDfmResult({ ruleset, violations, penalties: processFitPenalties(analysis.features, null, null), checkedAt: now });
        const [row] = await tx
            .update(parts)
            .set({
                status: 'READY',
                units: analysis.units,
                features: analysis.features,
                dfm,
                preview: analysis.preview,
                rulesetVersion: ruleset.version,
                error: null,
                fileSha256: sha,
                fileKey,
                sizeBytes: bytes.byteLength,
                designVersion,
                analyzedAt: now,
                updatedAt: now,
            })
            .where(eq(parts.id, partId))
            .returning();
        await emitEvent(tx, {
            type: 'part.analyzed',
            payload: { partId, status: 'READY', units: analysis.units, designVersion, error: null },
            actor: system,
            correlationId,
            buildId: locked.buildId,
        });
        await emitEvent(tx, {
            type: 'dfm.completed',
            payload: { partId, quoteId: null, rulesetVersion: ruleset.version, makeabilityScore: dfm.makeabilityScore, blocking: dfm.blocking, violationCount: dfm.violations.length },
            actor: system,
            correlationId,
            buildId: locked.buildId,
        });
        await setBuildStatus(tx, locked.buildId, dfm.blocking ? 'NEEDS_INPUT' : 'READY');
        return row;
    });

    return toPartView(updated, loaded.build);
}
