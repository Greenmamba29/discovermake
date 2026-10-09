/**
 * CAD result -> stored artifacts (+ an instantly quotable part per flat pattern).
 *
 * Every artifact (STEP, DXFs, GLB, BOM JSON + CSV, SVG drawing, manifest) is stored at
 * `builds/<buildId>/cad/v<version>/<filename>`. Each DXF flat pattern is attached to the
 * SAME build as a new part and run through the R1 analyzer, so the buyer can configure it
 * and get a BINDING quote on `/parts/:partId` exactly like an uploaded file. A multi-panel
 * result (sheet enclosure) gives one part per distinct panel, with its pieces per build.
 * Printed enclosures (3D print / CNC) have no flat pattern; they go to sourcing instead.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import type { PartView } from '@/contracts';
import type { CadPanelMetric } from '@/contracts/cad';
import { getDb } from '@/server/db';
import { builds, parts } from '@/server/db/schema';
import { emitEvent } from '@/server/events/outbox';
import { ApiError } from '@/server/http';
import { newId } from '@/server/ids';
import { analyzePart, uploadPartBytes } from '@/server/quote';
import { getStorage, storageKeys } from '@/server/storage';
import type { Actor } from '@/contracts';
import type { CadArtifactKind } from '@/contracts/cad';
import type { CadResult } from './client';

export type StoredCadArtifact = { kind: CadArtifactKind; key: string; filename: string; bytes: number; sha256: string };
export type CadPanelPart = { part: PartView; filename: string; label: string; quantity: number };

const FAMILY_PART_LABEL: Record<string, string> = {
    sheet_panel: 'Panel',
    l_bracket: 'L-bracket',
    u_channel: 'U-channel',
    multi_bend_bracket: 'Bracket',
    slotted_plate: 'Slotted plate',
};

export function cadArtifactKey(buildId: string, version: number, filename: string): string {
    return `builds/${buildId}/cad/v${version}/${filename}`;
}

export async function attachCadResult(input: {
    buildId: string;
    version: number;
    result: CadResult;
    actor: Actor;
}): Promise<{ artifacts: StoredCadArtifact[]; part: PartView | null; parts: CadPanelPart[] }> {
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

    const panels = (result.metrics.panels as CadPanelMetric[] | undefined) ?? [];
    const dxfs = result.artifacts.filter((a) => a.kind === 'DXF');
    const panelParts: CadPanelPart[] = [];
    for (const dxf of dxfs) {
        const panel = panels.find((p) => p.filename === dxf.filename);
        const partId = newId('part');
        const suffix = dxfs.length > 1 ? `-${dxf.filename.replace(/_flat\.dxf$|\.dxf$/, '').replace(/_/g, '-')}` : '';
        await db.insert(parts).values({
            id: partId,
            buildId,
            designVersion: version,
            fileKey: storageKeys.partSource(partId),
            filename: `${slug(build.name)}-v${version}${suffix}.dxf`,
            format: 'dxf',
            sizeBytes: dxf.bytes,
            status: 'AWAITING_UPLOAD',
        });
        await uploadPartBytes(partId, dxf.data);
        const part = await analyzePart(partId);
        panelParts.push({ part, filename: dxf.filename, label: panel?.label ?? FAMILY_PART_LABEL[result.family] ?? 'Flat pattern', quantity: panel?.quantity ?? 1 });
    }
    const part = panelParts[0]?.part ?? null;

    await db.transaction(async (tx) => {
        await emitEvent(tx, {
            type: 'cad.generated',
            payload: { buildId, version, family: result.family, partId: part?.id ?? null, artifacts: artifacts.map(({ kind, key, sha256 }) => ({ kind, key, sha256 })) },
            actor,
            correlationId: buildId,
            buildId,
        });
    });
    return { artifacts, part, parts: panelParts };
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
