/**
 * CAD result -> stored artifacts (+ an instantly quotable part for sheet families).
 *
 * Artifacts are stored at `builds/<buildId>/cad/v<version>/<filename>`. When the
 * result has a DXF flat pattern, it is attached to the SAME build as a new part and
 * run through the R1 analyzer, so the buyer can configure it and get a BINDING
 * quote on `/parts/:partId` exactly like an uploaded file. Enclosures (3D print /
 * CNC) have no flat pattern; they go to sourcing instead.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import type { PartView } from '@/contracts';
import { getDb } from '@/server/db';
import { builds, parts } from '@/server/db/schema';
import { emitEvent } from '@/server/events/outbox';
import { ApiError } from '@/server/http';
import { newId } from '@/server/ids';
import { analyzePart, uploadPartBytes } from '@/server/quote';
import { getStorage, storageKeys } from '@/server/storage';
import type { Actor } from '@/contracts';
import type { CadResult } from './client';

export type StoredCadArtifact = { kind: 'STEP' | 'DXF' | 'GLB'; key: string; filename: string; bytes: number; sha256: string };

export function cadArtifactKey(buildId: string, version: number, filename: string): string {
    return `builds/${buildId}/cad/v${version}/${filename}`;
}

export async function attachCadResult(input: { buildId: string; version: number; result: CadResult; actor: Actor }): Promise<{ artifacts: StoredCadArtifact[]; part: PartView | null }> {
    const { buildId, version, result, actor } = input;
    const db = getDb();
    const [build] = await db.select({ id: builds.id, name: builds.name }).from(builds).where(eq(builds.id, buildId));
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');

    const storage = getStorage();
    const artifacts: StoredCadArtifact[] = [];
    for (const a of result.artifacts) {
        const key = cadArtifactKey(buildId, version, a.filename);
        await storage.putObject(key, a.data, { contentType: a.content_type });
        artifacts.push({ kind: a.kind, key, filename: a.filename, bytes: a.bytes, sha256: a.sha256 });
    }

    let part: PartView | null = null;
    const dxf = result.artifacts.find((a) => a.kind === 'DXF');
    if (dxf) {
        const partId = newId('part');
        await db.insert(parts).values({
            id: partId,
            buildId,
            designVersion: version,
            fileKey: storageKeys.partSource(partId),
            filename: `${slug(build.name)}-v${version}.dxf`,
            format: 'dxf',
            sizeBytes: dxf.bytes,
            status: 'AWAITING_UPLOAD',
        });
        await uploadPartBytes(partId, dxf.data);
        part = await analyzePart(partId);
    }

    await db.transaction(async (tx) => {
        await emitEvent(tx, {
            type: 'cad.generated',
            payload: { buildId, version, family: result.family, partId: part?.id ?? null, artifacts: artifacts.map(({ kind, key, sha256 }) => ({ kind, key, sha256 })) },
            actor,
            correlationId: buildId,
            buildId,
        });
    });
    return { artifacts, part };
}

function slug(name: string): string {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'part'
    );
}
