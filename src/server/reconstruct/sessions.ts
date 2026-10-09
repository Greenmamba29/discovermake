/**
 * Reconstruct (R6): one session per build (`builds.origin = 'reconstruct'`).
 *
 *   createReconstruct     build + graph v1 (description, part:main) + session; optional passport prefill
 *   getReconstructView    photos (attachments) + measurements + dimensions + plan + CAD + quote
 *   updateReconstruct     choices (shaft, flutes, flange, bracket shape), material, quantity
 *   saveMeasurements      reference marks + lines per photo (estimates only, session row)
 *   confirmDimensions     caliper readings -> a new graph version with `dim:*` REQUIREMENT nodes
 *   generateReconstruct   planner (caliper readings only) -> approve -> CAD worker -> print quote
 *   quoteReconstruct      STL + manifest of the latest CAD version -> print quote engine
 *
 * Writes are owner-only (routes call `assertCanEditBuild`); every write emits its event.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Actor } from '@/contracts';
import type { BgEdgeInput, BgNodeInput, BuildGraphView } from '@/contracts/build-graph';
import { CadSpec, isPrintedSpec, printedMinWallMm, type PrintedCadSpec } from '@/contracts/cad';
import type { QuoteView } from '@/contracts/quotes';
import {
    ConfirmDimensionsRequest,
    CreateReconstructRequest,
    PhotoMeasurements,
    ReconstructOptions,
    ReconstructPartType,
    requiredDimensions,
    SaveMeasurementsRequest,
    UpdateReconstructRequest,
    type CreateReconstructResponse,
    type PassportPrefill,
    type ReconstructGenerateResponse,
    type ReconstructView,
} from '@/contracts/reconstruct';
import { photoEstimates, scaleFromReference, toMm } from '@/lib/reconstruct/measure';
import { approveVersion, getGraph, guestActor, latestVersionRow, loadVersionGraph, MAIN_PART_KEY, ROOT_NODE_KEY, toEdgeInput, toNodeInput, withDisplayId, writeVersion } from '@/server/build-graph';
import { isCadWorkerConfigured } from '@/server/cad/client';
import { generateBuildCad, type CadRecord } from '@/server/cad/build-cad';
import { getDb, withTx } from '@/server/db';
import { builds, parts, quotes, reconstructSessions } from '@/server/db/schema';
import { emitEvent } from '@/server/events/outbox';
import { ApiError } from '@/server/http';
import { newId } from '@/server/ids';
import { getPublicPassport } from '@/server/passport';
import { listPrintMaterials, loadPrintMaterialBySlug, PRINT_DFM_VERSION, createPrintQuote } from '@/server/quote/printing';
import { getStorage } from '@/server/storage';
import { listAttachments } from '@/server/workspace/attachments';
import { caliperNode, confirmedDims, dimensionViews, DIM_KEY_PREFIX, estimateNode, type ConfirmedDim, type Estimate } from './dimensions';
import { planReconstruction } from './planner';
import { isSegmentationEnabled } from './segmentation';

type SessionRow = typeof reconstructSessions.$inferSelect;

/** Default print material per part: heat-resistant ASA for knobs (stoves, amps), PETG otherwise. */
const DEFAULT_PRINT_MATERIAL: Record<string, string> = { knob: 'asa', spacer: 'petg', bracket: 'petg' };

export type Owner = { ownerUserId: string | null; deviceHash: string | null };

function actorFor(buildId: string, owner?: Owner | null): Actor {
    return owner?.ownerUserId ? { kind: 'buyer', id: owner.ownerUserId } : guestActor(buildId);
}

async function loadSession(buildId: string): Promise<SessionRow> {
    const [row] = await getDb().select().from(reconstructSessions).where(eq(reconstructSessions.buildId, buildId));
    if (!row) throw new ApiError('NOT_FOUND', 'Reconstruct session not found');
    return row;
}

const optionsOf = (s: SessionRow) => ReconstructOptions.parse(s.options ?? {});

/** Passport prefill: material and process from the PUBLIC snapshot only (no buyer data). */
export async function passportPrefill(passportId: string): Promise<PassportPrefill | null> {
    const p = await getPublicPassport(passportId);
    if (!p) return null;
    const s = p.snapshot;
    const name = s.material.name.toLowerCase();
    const printMaterialSlug = /\bpla\b/.test(name) ? 'pla' : /petg/.test(name) ? 'petg' : /\basa\b/.test(name) ? 'asa' : /nylon|pa12|pa 12/.test(name) ? 'nylon-pa12' : null;
    const sheet = /laser|brake|bend/i.test(s.process);
    return { passportId: p.id, orderNumber: s.orderNumber, buildName: s.build.name, materialName: `${s.material.name} ${s.material.thicknessLabel}`.trim(), processName: s.process, printMaterialSlug, suggestedPartType: sheet ? 'bracket' : 'knob' };
}

export async function createReconstruct(input: CreateReconstructRequest, owner: Owner): Promise<CreateReconstructResponse> {
    const req = CreateReconstructRequest.parse(input);
    const options = ReconstructOptions.parse(req.options ?? {});
    const prefill = req.passportId ? await passportPrefill(req.passportId) : null;
    if (req.passportId && !prefill) throw new ApiError('NOT_FOUND', 'That passport was not found or is not active.');
    const partType = req.partType;
    const label = { knob: 'Replacement knob', spacer: 'Replacement spacer', bracket: 'Replacement bracket' }[partType];
    const name = prefill ? `${label} for ${prefill.buildName}`.slice(0, 120) : label;

    return withDisplayId(async (displayId) =>
        withTx(async (tx) => {
            const buildId = newId('build');
            const actor = actorFor(buildId, owner);
            await tx.insert(builds).values({ id: buildId, displayId, name, status: 'NEEDS_INPUT', origin: 'reconstruct', currentVersion: 1, ownerUserId: owner.ownerUserId, deviceHash: owner.deviceHash });
            await emitEvent(tx, { type: 'build.created', payload: { buildId, displayId, name }, actor, correlationId: buildId, buildId });
            const nodes: BgNodeInput[] = [
                { key: ROOT_NODE_KEY, type: 'BUILD', label: name, data: { displayId, intent: 'reconstruct', partType, replacesPassportId: prefill?.passportId ?? null }, confidence: null, source: 'user', provenance: 'reconstruct' },
                { key: MAIN_PART_KEY, type: 'PART', label: `${label} · main part`, data: { role: 'main', reconstruct: true, partType }, confidence: null, source: 'user', provenance: 'reconstruct' },
            ];
            const edges: BgEdgeInput[] = [{ type: 'CONTAINS', fromKey: ROOT_NODE_KEY, toKey: MAIN_PART_KEY, data: {} }];
            if (req.description) {
                // What the buyer said about the broken part. Kept as context: no number in it is a dimension.
                nodes.push({ key: 'req:broken-part', type: 'REQUIREMENT', label: req.description.slice(0, 200), data: { category: 'context', note: req.description }, confidence: null, source: 'user', provenance: 'reconstruct:description' });
                edges.push({ type: 'CONSTRAINED_BY', fromKey: ROOT_NODE_KEY, toKey: 'req:broken-part', data: {} });
            }
            await writeVersion(tx, buildId, { parentVersion: null, summary: prefill ? `Reconstruct a part from order ${prefill.orderNumber}` : 'Reconstruct a broken part from photos', nodes, edges, actor });
            await tx.insert(reconstructSessions).values({
                id: newId('reconstruct'),
                buildId,
                passportId: prefill?.passportId ?? null,
                partType,
                description: req.description,
                options,
                measurements: [],
                printMaterialSlug: prefill?.printMaterialSlug ?? DEFAULT_PRINT_MATERIAL[partType] ?? 'petg',
                quantity: 1,
            });
            await emitEvent(tx, { type: 'reconstruct.started', payload: { buildId, partType, passportId: prefill?.passportId ?? null }, actor, correlationId: buildId, buildId });
            return { buildId, displayId, url: `/reconstruct/${buildId}?step=measure` };
        }),
    );
}

function estimatesFrom(session: SessionRow): Map<string, Estimate> {
    const out = new Map<string, Estimate>();
    for (const raw of session.measurements ?? []) {
        const photo = PhotoMeasurements.safeParse(raw);
        if (!photo.success) continue;
        for (const [param, e] of photoEstimates(photo.data)) out.set(param, e);
    }
    return out;
}

function cadRecordOf(view: BuildGraphView): (CadRecord & { version: number }) | null {
    const node = view.nodes.find((n) => n.key === MAIN_PART_KEY && n.data.cad);
    return node ? { ...(node.data.cad as CadRecord), version: node.designVersion } : null;
}

async function printedPartFor(buildId: string, version: number) {
    const [row] = await getDb()
        .select()
        .from(parts)
        .where(and(eq(parts.buildId, buildId), eq(parts.designVersion, version), eq(parts.format, 'stl')))
        .orderBy(desc(parts.createdAt))
        .limit(1);
    return row ?? null;
}

export async function getReconstructView(buildId: string, opts: { canEdit: boolean }): Promise<ReconstructView> {
    const db = getDb();
    const session = await loadSession(buildId);
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    const options = optionsOf(session);
    const partType = ReconstructPartType.parse(session.partType);
    const confirmed = confirmedDims(view.nodes);
    const estimates = estimatesFrom(session);
    const dimensions = dimensionViews(partType, options, confirmed, estimates);
    const plan = planReconstruction({ partType, options, confirmed });
    const { attachments } = await listAttachments(buildId);
    const measured = new Map((session.measurements ?? []).map((m) => [String((m as { attachmentId?: string }).attachmentId), PhotoMeasurements.safeParse(m)]));
    const photos = attachments
        .filter((a) => a.kind === 'image')
        .map((a) => {
            const m = measured.get(a.id);
            const data = m?.success ? m.data : null;
            return { attachmentId: a.id, filename: a.filename, url: a.thumbnailUrl ?? a.url, measurements: data, mmPerPx: data ? scaleFromReference(data.reference) : null };
        });
    const cad = cadRecordOf(view);
    let quoteId: string | null = null;
    let sheetPartId: string | null = null;
    if (cad) {
        if (isPrintedSpec(cad.spec)) {
            const part = await printedPartFor(buildId, cad.version);
            if (part) {
                const [q] = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.partId, part.id)).orderBy(desc(quotes.createdAt)).limit(1);
                quoteId = q?.id ?? null;
            }
        } else sheetPartId = cad.partId ?? null;
    }
    const [build] = await db.select().from(builds).where(eq(builds.id, buildId));
    return {
        buildId,
        displayId: view.build.displayId,
        name: view.build.name,
        partType,
        description: session.description,
        options,
        passport: session.passportId ? await passportPrefill(session.passportId) : null,
        photos,
        dimensions,
        allConfirmed: dimensions.every((d) => d.confirmedAt !== null),
        plan,
        printMaterials: await listPrintMaterials(db),
        printMaterialSlug: session.printMaterialSlug,
        quantity: session.quantity,
        cadAvailable: isCadWorkerConfigured(),
        autoDetect: isSegmentationEnabled(),
        cadVersion: cad?.version ?? null,
        quoteId,
        sheetPartId,
        canEdit: opts.canEdit,
        updatedAt: (build?.updatedAt ?? session.updatedAt).toISOString(),
    };
}

export async function updateReconstruct(buildId: string, input: UpdateReconstructRequest): Promise<void> {
    const req = UpdateReconstructRequest.parse(input);
    const session = await loadSession(buildId);
    if (req.printMaterialSlug && !(await loadPrintMaterialBySlug(getDb(), req.printMaterialSlug))) throw new ApiError('VALIDATION_FAILED', 'Unknown print material', 400);
    await getDb()
        .update(reconstructSessions)
        .set({
            options: req.options ? ReconstructOptions.parse({ ...optionsOf(session), ...req.options }) : session.options,
            description: req.description ?? session.description,
            printMaterialSlug: req.printMaterialSlug ?? session.printMaterialSlug,
            quantity: req.quantity ?? session.quantity,
            updatedAt: new Date(),
        })
        .where(eq(reconstructSessions.id, session.id));
}

export async function saveMeasurements(buildId: string, input: SaveMeasurementsRequest): Promise<void> {
    const req = SaveMeasurementsRequest.parse(input);
    const session = await loadSession(buildId);
    const { attachments } = await listAttachments(buildId);
    const images = new Set(attachments.filter((a) => a.kind === 'image').map((a) => a.id));
    for (const p of req.photos) if (!images.has(p.attachmentId)) throw new ApiError('VALIDATION_FAILED', 'Measurements must belong to a photo on this build.', 400);
    const kept = (session.measurements ?? []).filter((m) => !req.photos.some((p) => p.attachmentId === (m as { attachmentId?: string }).attachmentId));
    await getDb()
        .update(reconstructSessions)
        .set({ measurements: [...kept, ...req.photos].slice(-6), updatedAt: new Date() })
        .where(eq(reconstructSessions.id, session.id));
}

/**
 * Confirm caliper / ruler readings: each becomes a buyer-stated `dim:*` node (mm, 0.01) in a new
 * design version, with its photo estimate and the delta recorded beside it. Required dimensions
 * still without a reading are written as photo estimates (not buyer-stated).
 */
export async function confirmDimensions(buildId: string, input: ConfirmDimensionsRequest, opts: { owner?: Owner | null; now?: Date } = {}): Promise<number> {
    const req = ConfirmDimensionsRequest.parse(input);
    const now = opts.now ?? new Date();
    const session = await loadSession(buildId);
    const partType = ReconstructPartType.parse(session.partType);
    const options = optionsOf(session);
    const defs = requiredDimensions(partType, options);
    const byParam = new Map(defs.map((d) => [d.param as string, d]));
    for (const r of req.readings) if (!byParam.has(r.param)) throw new ApiError('VALIDATION_FAILED', `${r.param} is not a dimension this part needs.`, 400);
    const estimates = estimatesFrom(session);
    const actor = actorFor(buildId, opts.owner);

    return withTx(async (tx) => {
        const latest = await latestVersionRow(tx, buildId);
        if (!latest) throw new ApiError('NOT_FOUND', 'Build not found');
        const graph = await loadVersionGraph(tx, buildId, latest.version);
        const confirmed = confirmedDims(graph.nodes);
        for (const r of req.readings) {
            const def = byParam.get(r.param)!;
            const valueMm = toMm(r.value, r.unit);
            confirmed.set(r.param, { param: r.param, label: def.label, valueMm, enteredValue: r.value, enteredUnit: r.unit, confirmedAt: now.toISOString(), photoEstimateMm: estimates.get(r.param)?.mm ?? null } satisfies ConfirmedDim);
        }
        const nodes = graph.nodes.filter((n) => !n.key.startsWith(DIM_KEY_PREFIX)).map(toNodeInput);
        const edges = graph.edges.filter((e) => !e.toKey.startsWith(DIM_KEY_PREFIX)).map(toEdgeInput);
        const holder = nodes.some((n) => n.key === MAIN_PART_KEY) ? MAIN_PART_KEY : ROOT_NODE_KEY;
        for (const def of defs) {
            const c = confirmed.get(def.param);
            const e = estimates.get(def.param) ?? null;
            const node = c ? caliperNode(c, e) : e ? estimateNode(def.param, def.label, e) : null;
            if (!node) continue;
            nodes.push(node);
            edges.push({ type: 'CONSTRAINED_BY', fromKey: holder, toKey: node.key, data: {} });
        }
        const params = req.readings.map((r) => byParam.get(r.param)!.label.toLowerCase());
        const v = await writeVersion(tx, buildId, { parentVersion: latest.version, summary: `Confirmed ${params.join(', ')} with a caliper`, nodes, edges, actor });
        for (const r of req.readings) {
            const c = confirmed.get(r.param)!;
            await emitEvent(tx, {
                type: 'reconstruct.dimension_confirmed',
                payload: { buildId, version: v.version, param: r.param, valueMm: c.valueMm, unit: r.unit, photoEstimateMm: c.photoEstimateMm, deltaPct: c.photoEstimateMm ? Math.round((Math.abs(c.photoEstimateMm - c.valueMm) / c.valueMm) * 1000) / 10 : null },
                actor,
                correlationId: buildId,
                buildId,
            });
        }
        return v.version;
    });
}

/**
 * Generate: the planner turns the CONFIRMED caliper readings into a family + spec (or lists what
 * is missing); nothing is generated until every critical dimension is confirmed. Then the version
 * carrying the readings is approved (the buyer pressed Generate), the CAD worker builds it
 * (`generateBuildCad`, unchanged), and a printed part gets its print quote straight away.
 * Without CAD_WORKER_URL this answers 503 and writes nothing.
 */
export async function generateReconstruct(buildId: string, opts: { owner?: Owner | null; fetchImpl?: typeof fetch } = {}): Promise<ReconstructGenerateResponse> {
    const session = await loadSession(buildId);
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    const plan = planReconstruction({ partType: ReconstructPartType.parse(session.partType), options: optionsOf(session), confirmed: confirmedDims(view.nodes) });
    if (plan.status === 'needs_input') return plan;
    if (!isCadWorkerConfigured()) throw new ApiError('NOT_IMPLEMENTED', 'The CAD service is unavailable right now. Your confirmed readings are saved; try Generate again later.', 503, { reason: 'CAD_UNAVAILABLE' });
    const actor = actorFor(buildId, opts.owner);
    const latest = await latestVersionRow(getDb(), buildId);
    if (latest && latest.status === 'DRAFT') await approveVersion(buildId, latest.version, { actor });
    const spec = CadSpec.parse(plan.spec);
    const result = await generateBuildCad(buildId, { spec, actor, fetchImpl: opts.fetchImpl });
    if (result.status !== 'generated') throw new ApiError('CONFLICT', result.status === 'not_supported' ? result.reason : 'CAD needs more input.');
    let quoteId: string | null = null;
    if (isPrintedSpec(spec)) {
        const quote = await quoteReconstruct(buildId, { printMaterialSlug: session.printMaterialSlug ?? DEFAULT_PRINT_MATERIAL[session.partType] ?? 'petg', quantity: session.quantity });
        quoteId = quote.id;
    }
    await withTx(async (tx) => {
        await emitEvent(tx, { type: 'reconstruct.cad_generated', payload: { buildId, version: result.version, family: result.family, printed: isPrintedSpec(spec), quoteId }, actor, correlationId: buildId, buildId });
    });
    return { status: 'generated', version: result.version, family: result.family, quoteId, sheetPartId: isPrintedSpec(spec) ? null : result.partId };
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

type Manifest = { family?: string; metrics?: { bbox_mm?: number[]; volume_mm3?: number; surface_area_mm2?: number; min_wall_mm?: number; bridge_span_mm?: number } };

/**
 * Print quote for the latest CAD version: the STL (sha256 checked against the CAD record)
 * becomes a READY printed part (once per version), and the print engine prices it from the
 * worker MANIFEST's geometry. The buyer's caliper dimensions go along as QA checks.
 */
export async function quoteReconstruct(buildId: string, input: { printMaterialSlug: string; quantity: number }): Promise<QuoteView> {
    const db = getDb();
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'Build not found');
    const cad = cadRecordOf(view);
    if (!cad) throw new ApiError('CONFLICT', 'Generate the CAD first.');
    const spec = CadSpec.parse(cad.spec);
    if (!isPrintedSpec(spec)) throw new ApiError('CONFLICT', 'This part is laser cut: quote its flat pattern instead.');
    const stl = cad.artifacts.find((a) => a.kind === 'STL');
    const manifestArt = cad.artifacts.find((a) => a.kind === 'MANIFEST');
    if (!stl || !manifestArt) throw new ApiError('CONFLICT', 'This CAD version has no STL or manifest. Generate it again.');
    const storage = getStorage();
    const [stlBuf, manifestBuf] = await Promise.all([storage.getObject(stl.key), storage.getObject(manifestArt.key)]);
    if (!stlBuf || !manifestBuf) throw new ApiError('CONFLICT', 'The CAD files are missing from storage. Generate again.');
    const stlBytes = new Uint8Array(stlBuf);
    if (sha256(stlBytes) !== stl.sha256 || sha256(new Uint8Array(manifestBuf)) !== manifestArt.sha256) throw new ApiError('CONFLICT', 'The CAD files do not match their checksums. Generate again.');
    const manifest = JSON.parse(manifestBuf.toString('utf8')) as Manifest;
    const m = manifest.metrics ?? {};
    const bbox = (m.bbox_mm ?? (cad.metrics.bbox_mm as number[])) as number[];
    const volume = m.volume_mm3 ?? cad.metrics.volume_mm3;
    const area = m.surface_area_mm2 ?? (cad.metrics as { surface_area_mm2?: number }).surface_area_mm2;
    if (!Array.isArray(bbox) || bbox.length !== 3 || !(volume > 0) || !area || !(area > 0)) throw new ApiError('CONFLICT', 'The CAD manifest has no geometry to price. Generate again.');

    let part = await printedPartFor(buildId, cad.version);
    if (!part) {
        const partId = newId('part');
        const key = `parts/${partId}/source.stl`;
        await storage.putObject(key, stlBytes, { contentType: 'model/stl' });
        const slug = view.build.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'part';
        [part] = await db
            .insert(parts)
            .values({ id: partId, buildId, designVersion: cad.version, fileKey: key, filename: `${slug}-v${cad.version}.stl`, format: 'stl', sizeBytes: stlBytes.byteLength, fileSha256: stl.sha256, units: 'mm', status: 'READY', rulesetVersion: PRINT_DFM_VERSION, analyzedAt: new Date() })
            .returning();
    }
    const confirmed = confirmedDims(view.nodes);
    const criticalDims = [...confirmed.values()].map((c) => ({ param: c.param, label: c.label, nominalMm: c.valueMm }));
    const quote = await createPrintQuote({
        partId: part!.id,
        printMaterialSlug: input.printMaterialSlug,
        quantity: input.quantity,
        geometry: { bboxMm: [bbox[0]!, bbox[1]!, bbox[2]!], volumeMm3: volume, surfaceAreaMm2: area, minWallMm: m.min_wall_mm ?? printedMinWallMm(spec as PrintedCadSpec), bridgeSpanMm: m.bridge_span_mm ?? 0 },
        family: spec.family,
        stlSha256: stl.sha256,
        criticalDims,
    });
    await db.update(reconstructSessions).set({ printMaterialSlug: input.printMaterialSlug, quantity: input.quantity, updatedAt: new Date() }).where(eq(reconstructSessions.buildId, buildId));
    return quote;
}

/** The photo bytes for auto-detect (an image attachment of this build). */
export async function photoBytes(buildId: string, attachmentId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const { attachments } = await listAttachments(buildId);
    const a = attachments.find((x) => x.id === attachmentId && x.kind === 'image');
    if (!a) throw new ApiError('NOT_FOUND', 'Photo not found');
    const { buildAttachments } = await import('@/server/db/schema');
    const [row] = await getDb().select({ key: buildAttachments.storageKey }).from(buildAttachments).where(eq(buildAttachments.id, attachmentId));
    const buf = row ? await getStorage().getObject(row.key) : null;
    if (!buf) throw new ApiError('NOT_FOUND', 'Photo not found');
    return { bytes: new Uint8Array(buf), contentType: a.contentType };
}
