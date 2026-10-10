/**
 * Kid designs: template + bounded options -> the workshop (text-to-CAD worker) -> a BINDING
 * 3D-print quote from the real print engine. Nothing a kid types goes to an AI model: the
 * template is our own parametric model and the label is a validated parameter.
 *
 *   createKidDesign   validate the template and options for this kid, store, then price
 *   priceKidDesign    workshop (when its result is missing) -> build + printed part -> print quote
 *
 * With no worker configured the design is `offline` and no price is shown (never an estimate).
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { kidDesignOptions, kidPrice, type KidDesignStatus, type KidDesignView } from '@/contracts/kids';
import { KID_TEMPLATES, KidTemplateId as KidTemplateIdSchema, parseKidTemplateParams, type KidTemplateId } from '@/contracts/text-to-cad';
import type { QuoteView } from '@/contracts/quotes';
import { withDisplayId } from '../build-graph';
import { buildKidTemplate, isTextToCadConfigured, TextToCadError } from '../cad/text-to-cad';
import { getDb, withTx } from '../db';
import { builds, kidDesigns, kidRequests, parts, type KidCadRecord } from '../db/schema';
import { ApiError } from '../http';
import { newId } from '../ids';
import { getQuote } from '../quote';
import { createPrintQuote, PRINT_DFM_VERSION } from '../quote/printing';
import { getStorage } from '../storage';
import type { KidSession } from './session';

type DesignRow = typeof kidDesigns.$inferSelect;

/** Kid projects print in PLA (indoor, many colours). */
export const KID_PRINT_MATERIAL = 'pla';
/** Design rule of our kid templates (services/cad-worker kid templates): every wall is at least 2 mm. */
export const KID_TEMPLATE_MIN_WALL_MM = 2;

export const KID_MESSAGES = {
    offline: 'The workshop is offline right now. Please try again later.',
    failed: 'The workshop could not make this one. Try different choices.',
    unpriceable: 'We can’t make this one right now. Try a smaller size or a different choice.',
    noWorkshop: 'No workshop can make this right now. Please try again later.',
} as const;

export type KidDesignOpts = { fetchImpl?: typeof fetch; now?: Date };

export async function loadKidDesign(kid: KidSession, designId: string): Promise<DesignRow> {
    const [row] = await getDb()
        .select()
        .from(kidDesigns)
        .where(and(eq(kidDesigns.id, designId), eq(kidDesigns.kidId, kid.kid.id), eq(kidDesigns.ownerUserId, kid.ownerUserId)))
        .limit(1);
    if (!row) throw new ApiError('NOT_FOUND', 'We could not find that one.');
    return row;
}

export function allowedTemplatesOf(kid: KidSession['kid']): KidTemplateId[] {
    const raw = Array.isArray(kid.allowedTemplates) ? kid.allowedTemplates : [];
    return raw.filter((t): t is KidTemplateId => KidTemplateIdSchema.safeParse(t).success);
}

export async function createKidDesign(kid: KidSession, input: { template: KidTemplateId; params: Record<string, unknown> }, opts: KidDesignOpts = {}): Promise<KidDesignView> {
    if (!allowedTemplatesOf(kid.kid).includes(input.template)) throw new ApiError('FORBIDDEN', 'Ask a grown-up to turn this project on for you.', 403);
    const params = parseKidTemplateParams(input.template, input.params);
    const [row] = await getDb()
        .insert(kidDesigns)
        .values({ id: newId('kidDesign'), kidId: kid.kid.id, ownerUserId: kid.ownerUserId, template: input.template, params: params as Record<string, unknown>, status: 'new' })
        .returning();
    return priceDesignRow(kid, row!, opts);
}

export async function priceKidDesign(kid: KidSession, designId: string, opts: KidDesignOpts = {}): Promise<KidDesignView> {
    return priceDesignRow(kid, await loadKidDesign(kid, designId), opts);
}

async function setStatus(row: DesignRow, patch: Partial<typeof kidDesigns.$inferInsert>): Promise<DesignRow> {
    const [updated] = await getDb()
        .update(kidDesigns)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(kidDesigns.id, row.id))
        .returning();
    return updated!;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function runWorkshop(row: DesignRow, opts: KidDesignOpts): Promise<{ row: DesignRow; message: string | null }> {
    if (!isTextToCadConfigured()) return { row: await setStatus(row, { status: 'offline' }), message: KID_MESSAGES.offline };
    const template = row.template as KidTemplateId;
    try {
        const result = await buildKidTemplate(template, parseKidTemplateParams(template, row.params), { fetchImpl: opts.fetchImpl });
        if (!result.geometry.sound || result.geometry.solids < 1) return { row: await setStatus(row, { status: 'failed' }), message: KID_MESSAGES.failed };
        if (!result.artifacts.some((a) => a.kind === 'stl')) return { row: await setStatus(row, { status: 'failed' }), message: KID_MESSAGES.failed };
        const storage = getStorage();
        const artifacts: KidCadRecord['artifacts'] = [];
        for (const a of result.artifacts) {
            const key = `kids/designs/${row.id}/${a.filename.replace(/[^A-Za-z0-9._-]/g, '_')}`;
            await storage.putObject(key, a.data, { contentType: a.kind === 'stl' ? 'model/stl' : a.kind === 'glb' ? 'model/gltf-binary' : 'model/step' });
            artifacts.push({ kind: a.kind, filename: a.filename, key, sha256: a.sha256, bytes: a.bytes });
        }
        const cad: KidCadRecord = { engine: result.engine, geometry: result.geometry, artifacts, warnings: result.warnings, buildMs: result.buildMs };
        return { row: await setStatus(row, { cad, status: 'new' }), message: null };
    } catch (err) {
        if (err instanceof TextToCadError) {
            const offline = err.code === 'NETWORK' || err.code === 'UNAVAILABLE' || err.code === 'TIMEOUT';
            console.warn(`[kids] workshop ${err.code} for ${row.id}: ${err.message}`);
            return { row: await setStatus(row, { status: offline ? 'offline' : 'failed' }), message: offline ? KID_MESSAGES.offline : err.code === 'TOO_LARGE' ? KID_MESSAGES.unpriceable : KID_MESSAGES.failed };
        }
        throw err;
    }
}

/**
 * The printed part for a design (once): a `kids` build owned by the grown-up, named after the
 * template only (the kid's words never go into names, filenames or notes), with the workshop STL
 * checked against its sha256.
 */
async function ensurePrintedPart(row: DesignRow): Promise<DesignRow> {
    if (row.partId && row.buildId) return row;
    const cad = row.cad!;
    const stl = cad.artifacts.find((a) => a.kind === 'stl');
    if (!stl) throw new ApiError('CONFLICT', 'The workshop result has no STL.');
    const storage = getStorage();
    const bytes = await storage.getObject(stl.key);
    if (!bytes || sha256(new Uint8Array(bytes)) !== stl.sha256) throw new ApiError('CONFLICT', 'The workshop files do not match their checksum.');
    const template = row.template as KidTemplateId;
    const title = KID_TEMPLATES[template].title;
    const partId = newId('part');
    const key = `parts/${partId}/source.stl`;
    await storage.putObject(key, new Uint8Array(bytes), { contentType: 'model/stl' });
    const { buildId } = await withDisplayId((displayId) =>
        withTx(async (db) => {
            const buildId = newId('build');
            await db.insert(builds).values({ id: buildId, displayId, name: `${title} (Kids project)`, status: 'DRAFT', origin: 'kids', ownerUserId: row.ownerUserId, deviceHash: null });
            await db.insert(parts).values({ id: partId, buildId, designVersion: 1, fileKey: key, filename: `${template.replace(/_/g, '-')}.stl`, format: 'stl', sizeBytes: bytes.byteLength, fileSha256: stl.sha256, units: 'mm', status: 'READY', rulesetVersion: PRINT_DFM_VERSION, analyzedAt: new Date() });
            return { buildId };
        }),
    );
    return setStatus(row, { buildId, partId });
}

/** A fresh print quote for a design that has its workshop result (also used when a grown-up approves an expired one). */
export async function quoteDesign(row: DesignRow, now: Date = new Date()): Promise<{ row: DesignRow; quote: QuoteView }> {
    const withPart = await ensurePrintedPart(row);
    const cad = withPart.cad!;
    const g = cad.geometry;
    const stl = cad.artifacts.find((a) => a.kind === 'stl')!;
    const params = withPart.params as { color?: string };
    const quote = await createPrintQuote(
        {
            partId: withPart.partId!,
            printMaterialSlug: KID_PRINT_MATERIAL,
            quantity: 1,
            geometry: { bboxMm: [g.bbox_mm[0], g.bbox_mm[1], g.bbox_mm[2]], volumeMm3: g.volume_mm3, surfaceAreaMm2: g.area_mm2, minWallMm: KID_TEMPLATE_MIN_WALL_MM, bridgeSpanMm: 0 },
            family: `kid_${withPart.template}`,
            stlSha256: stl.sha256,
            criticalDims: [],
            notes: [`Kids & Family project: ${KID_TEMPLATES[withPart.template as KidTemplateId].title}`, `Colour: ${params.color ?? 'any'}`],
        },
        now,
    );
    const binding = quote.trustLevel === 'BINDING' && quote.status === 'READY';
    const updated = await setStatus(withPart, { quoteId: quote.id, priceCents: binding ? quote.subtotalCents : null, currency: quote.currency, status: binding ? 'priced' : 'unpriceable' });
    return { row: updated, quote };
}

async function priceDesignRow(kid: KidSession, input: DesignRow, opts: KidDesignOpts): Promise<KidDesignView> {
    let row = input;
    // Still a good price? Show it again.
    if (row.status === 'priced' && row.quoteId) {
        const q = await getQuote(row.quoteId);
        if (q?.orderable) return toKidDesignView(kid, row, null);
    }
    let message: string | null = null;
    if (!row.cad) {
        ({ row, message } = await runWorkshop(row, opts));
        if (!row.cad) return toKidDesignView(kid, row, message);
    }
    try {
        ({ row } = await quoteDesign(row, opts.now));
    } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
            console.warn(`[kids] no price for ${row.id}: ${err.message}`);
            row = await setStatus(row, { status: 'unpriceable', priceCents: null });
            return toKidDesignView(kid, row, /partner/i.test(err.message) ? KID_MESSAGES.noWorkshop : KID_MESSAGES.unpriceable);
        }
        throw err;
    }
    return toKidDesignView(kid, row, row.status === 'priced' ? null : KID_MESSAGES.unpriceable);
}

export async function glbUrlFor(cad: KidCadRecord | null | undefined): Promise<string | null> {
    const glb = cad?.artifacts.find((a) => a.kind === 'glb');
    if (!glb) return null;
    try {
        return (await getStorage().getSignedUrl(glb.key, { method: 'GET', expiresInSeconds: 900 })).url;
    } catch {
        return null;
    }
}

export async function toKidDesignView(kid: KidSession, row: DesignRow, message: string | null): Promise<KidDesignView> {
    const template = row.template as KidTemplateId;
    const priced = row.status === 'priced' && row.priceCents !== null;
    const limit = kid.kid.spendingLimitCents;
    const withinLimit = priced && row.priceCents! <= limit;
    const [request] = await getDb().select({ id: kidRequests.id }).from(kidRequests).where(eq(kidRequests.designId, row.id)).limit(1);
    const status = row.status as KidDesignStatus;
    const fallback = status === 'offline' ? KID_MESSAGES.offline : status === 'failed' ? KID_MESSAGES.failed : status === 'unpriceable' ? KID_MESSAGES.unpriceable : null;
    return {
        id: row.id,
        template,
        templateTitle: KID_TEMPLATES[template].title,
        options: kidDesignOptions(template, row.params),
        status,
        priceCents: priced ? row.priceCents : null,
        currency: row.currency,
        limitCents: limit,
        withinLimit,
        glbUrl: await glbUrlFor(row.cad),
        message: priced && !withinLimit ? `That costs ${kidPrice(row.priceCents!)}. Your grown-up said up to ${kidPrice(limit)}. Pick a smaller option.` : (message ?? fallback),
        requestId: request?.id ?? null,
    };
}
