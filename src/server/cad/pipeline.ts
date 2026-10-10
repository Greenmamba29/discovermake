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
import { and, eq, inArray } from 'drizzle-orm';
import type { PartView } from '@/contracts';
import type { CadPanelMetric } from '@/contracts/cad';
import { getDb } from '@/server/db';
import { builds, parts } from '@/server/db/schema';
import { emitEvent } from '@/server/events/outbox';
import { ApiError } from '@/server/http';
import { newId } from '@/server/ids';
import { analyzePart, getPart, uploadPartBytes } from '@/server/quote';
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
    // Parts created by THIS call: removed again if a later panel fails, so a failure never
    // leaves half a decomposition behind. Parts reused from an earlier attempt are kept.
    const created: string[] = [];
    try {
        for (const dxf of dxfs) {
            const panel = panels.find((p) => p.filename === dxf.filename);
            const suffix = dxfs.length > 1 ? `-${dxf.filename.replace(/_flat\.dxf$|\.dxf$/, '').replace(/_/g, '-')}` : '';
            const filename = `${slug(build.name)}-v${version}${suffix}.dxf`;
            const label = panel?.label ?? FAMILY_PART_LABEL[result.family] ?? 'Flat pattern';
            const quantity = panel?.quantity ?? 1;
            // Retry after a failed version write: the same bytes at the same version reuse the part.
            const reused = await reusablePart(buildId, version, filename, dxf.sha256);
            if (reused) {
                panelParts.push({ part: reused, filename: dxf.filename, label, quantity });
                continue;
            }
            const partId = newId('part');
            await db.insert(parts).values({
                id: partId,
                buildId,
                designVersion: version,
                fileKey: storageKeys.partSource(partId),
                filename,
                format: 'dxf',
                sizeBytes: dxf.bytes,
                status: 'AWAITING_UPLOAD',
            });
            created.push(partId);
            await uploadPartBytes(partId, dxf.data);
            const part = await analyzePart(partId);
            panelParts.push({ part, filename: dxf.filename, label, quantity });
        }
    } catch (err) {
        await discardParts(created);
        throw err;
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

async function reusablePart(buildId: string, version: number, filename: string, sha256: string): Promise<PartView | null> {
    const [row] = await getDb()
        .select({ id: parts.id })
        .from(parts)
        .where(and(eq(parts.buildId, buildId), eq(parts.designVersion, version), eq(parts.filename, filename), eq(parts.fileSha256, sha256), eq(parts.status, 'READY')))
        .limit(1);
    return row ? getPart(row.id) : null;
}

/** Best effort: parts from a failed attempt have no quotes or orders yet. */
async function discardParts(partIds: string[]): Promise<void> {
    if (!partIds.length) return;
    const storage = getStorage();
    try {
        await getDb().delete(parts).where(inArray(parts.id, partIds));
    } catch (err) {
        console.warn('[cad] could not discard parts from a failed generation', err instanceof Error ? err.message : err);
        return;
    }
    for (const id of partIds) await storage.deleteObject(storageKeys.partSource(id)).catch(() => undefined);
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
