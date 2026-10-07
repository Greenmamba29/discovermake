/**
 * The technical package handed to sourcing agents (`get_attachments`).
 *
 * REDACTED (always allowed under a valid lease):
 *   - a request sheet (text) with what suppliers need to quote: no internal ids, no target cost;
 *   - the 2D flat-pattern preview as SVG (generated from the analyzed part; never the source CAD).
 * FULL (needs an APPROVED RELEASE_FULL_PACKAGE for that exact supplier, see ./policy.ts):
 *   - the redacted files plus the source CAD file of the job's design version.
 *
 * Files are generated once per job + design version under `sourcing/<jobId>/package/v<n>/`.
 * URLs are signed and expire after 15 minutes; every URL handed out is written to
 * `sourcing_access_log`, mirrored by one `sourcing.package_accessed` event per call.
 */
import { eq } from 'drizzle-orm';
import type { PackageTier } from '../../contracts/enums';
import type { PartPreview } from '../../contracts/parts';
import type { z } from 'zod';
import type { GetAttachmentsInput, SignedAttachment, SourcingRequest } from '../../contracts/sourcing';
import { getDb, withTx } from '../db';
import { parts, sourcingAccessLog } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { getStorage } from '../storage';
import { enforceBoundary } from './boundary';
import { SIGNED_URL_TTL_SECONDS } from './constants';
import { assertLease, agentActor } from './jobs';
import type { JobRow } from './views';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const mm = (n: number) => String(Math.round(n * 100) / 100);

/** Human-readable request sheet for suppliers. Deliberately omits internal ids and the buyer's target cost. */
export function renderRequestSheet(request: SourcingRequest, tier: PackageTier): string {
    const list = (xs: string[]) => (xs.length ? xs.join('; ') : 'none specified');
    const dims = request.dimensions_mm ? `${mm(request.dimensions_mm.x)} x ${mm(request.dimensions_mm.y)} x ${mm(request.dimensions_mm.z)} mm (flat, L x W x thickness)` : 'see drawing';
    const tolerances = request.critical_tolerances.length
        ? request.critical_tolerances.map((t) => `${t.feature}: ${t.nominal_mm} mm +${t.plus_mm}/-${t.minus_mm}`).join('; ')
        : 'none beyond the drawing';
    return [
        `DiscoverMake request for quotation ${request.display_id}`,
        `Design version: ${request.design_version}`,
        '',
        `Part: ${request.name}`,
        `Quantity: ${request.quantity}`,
        `Material: ${request.material}`,
        `Processes: ${request.process.join(', ')}`,
        `Dimensions: ${dims}`,
        `Surface finish: ${request.surface_finish ?? 'none'}`,
        `Critical tolerances: ${tolerances}`,
        `Required certifications: ${list(request.required_certifications)}`,
        `Target delivery date: ${request.target_delivery_date ?? 'as soon as possible'}`,
        `Acceptable substitutions: ${list(request.acceptable_substitutions)}`,
        ...(request.notes ? ['', `Notes: ${request.notes}`] : []),
        '',
        'Please quote in USD: unit price, tooling, sample cost, MOQ, production lead time (days),',
        'shipping lead time (days), Incoterm, and any deviation from this request (material,',
        'tolerance, finish). Quote against this exact design version.',
        '',
        tier === 'FULL'
            ? 'Package: FULL (source CAD included). Confidential: do not share outside your company.'
            : 'Package: REDACTED (2D preview only). The full CAD package is released per supplier after approval.',
        '',
    ].join('\n');
}

/** 2D flat-pattern preview as a standalone SVG (y flipped: part space has its origin bottom-left). */
export function renderPreviewSvg(preview: PartPreview, request: Pick<SourcingRequest, 'display_id' | 'design_version'>): string {
    const w = Math.max(preview.widthMm, 1);
    const h = Math.max(preview.heightMm, 1);
    const pad = Math.max(w, h) * 0.06;
    const label = `${request.display_id} · v${request.design_version} · ${mm(preview.widthMm)} x ${mm(preview.heightMm)} mm`;
    const fontSize = Math.max(w, h) * 0.035;
    const bends = preview.bendLines
        .map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#d33" stroke-dasharray="${mm(fontSize)}" stroke-width="${mm(fontSize / 6)}"/>`)
        .join('');
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mm(-pad)} ${mm(-pad)} ${mm(w + 2 * pad)} ${mm(h + 3 * pad)}" width="${mm(w + 2 * pad)}mm" height="${mm(h + 3 * pad)}mm">`,
        `<title>${esc(label)}</title>`,
        `<g transform="translate(0 ${mm(h)}) scale(1 -1)">`,
        `<path d="${esc(preview.svgPath)}" fill="#e8edf3" fill-rule="evenodd" stroke="#1f2937" stroke-width="${mm(fontSize / 8)}"/>`,
        bends,
        '</g>',
        `<text x="0" y="${mm(h + 2 * pad)}" font-family="sans-serif" font-size="${mm(fontSize)}" fill="#1f2937">${esc(label)}</text>`,
        '</svg>',
        '',
    ].join('');
}

type PackageFile = { name: string; key: string; contentType: string; tier: PackageTier };

const packageKey = (job: Pick<JobRow, 'id' | 'designVersion'>, name: string) => `sourcing/${job.id}/package/v${job.designVersion}/${name}`;

/** Generate (once) and list the files of a package tier. Never includes the source CAD for REDACTED. */
export async function ensurePackage(job: JobRow, tier: PackageTier): Promise<PackageFile[]> {
    const storage = getStorage();
    const files: PackageFile[] = [];

    const sheetKey = packageKey(job, `request-sheet-${tier.toLowerCase()}.txt`);
    if (!(await storage.headObject(sheetKey))) await storage.putObject(sheetKey, renderRequestSheet(job.request, tier), { contentType: 'text/plain; charset=utf-8' });
    files.push({ name: 'request-sheet.txt', key: sheetKey, contentType: 'text/plain', tier: 'REDACTED' });

    const [part] = job.partId ? await getDb().select().from(parts).where(eq(parts.id, job.partId)) : [];
    if (part?.preview) {
        const svgKey = packageKey(job, 'preview.svg');
        if (!(await storage.headObject(svgKey))) await storage.putObject(svgKey, renderPreviewSvg(part.preview, job.request), { contentType: 'image/svg+xml' });
        files.push({ name: 'preview.svg', key: svgKey, contentType: 'image/svg+xml', tier: 'REDACTED' });
    }
    if (tier === 'FULL' && part && part.designVersion === job.designVersion && (await storage.headObject(part.fileKey))) {
        files.push({ name: part.filename, key: part.fileKey, contentType: 'application/dxf', tier: 'FULL' });
    }
    return files;
}

export type GetAttachmentsArgs = z.output<typeof GetAttachmentsInput>;

/** Signed, expiring, access-logged package URLs for the leaseholder. FULL is gated by the policy. */
export async function getAttachments(input: GetAttachmentsArgs, clientId: string, opts: { now?: Date } = {}): Promise<SignedAttachment[]> {
    const now = opts.now ?? new Date();
    const actor = agentActor(clientId);
    const job = await withTx((tx) => assertLease(tx, { jobId: input.sourcing_request_id, leaseId: input.lease_id, clientId, write: false, now }));
    const tier = input.tier;
    await enforceBoundary(tier === 'FULL' ? 'fetch_full_package' : 'fetch_redacted_package', { job, actor, tool: 'get_attachments', supplierId: input.supplier_id ?? null });

    const files = await ensurePackage(job, tier);
    const storage = getStorage();
    const signed = await Promise.all(
        files.map(async (f) => {
            const url = await storage.getSignedUrl(f.key, { method: 'GET', expiresInSeconds: SIGNED_URL_TTL_SECONDS, downloadFilename: f.name });
            return { file: f, url };
        }),
    );

    await withTx(async (tx) => {
        await tx.insert(sourcingAccessLog).values(
            signed.map(({ file, url }) => ({
                jobId: job.id,
                clientId,
                supplierId: input.supplier_id ?? null,
                tier: file.tier,
                fileKey: file.key,
                expiresAt: url.expiresAt,
                createdAt: now,
            })),
        );
        await emitEvent(tx, {
            type: 'sourcing.package_accessed',
            payload: { jobId: job.id, clientId, tier, supplierId: input.supplier_id ?? null },
            actor,
            correlationId: job.buildId,
            buildId: job.buildId,
            timestamp: now,
        });
    });

    return signed.map(({ file, url }) => ({ name: file.name, tier: file.tier, url: url.url, expires_at: url.expiresAt.toISOString() }));
}
