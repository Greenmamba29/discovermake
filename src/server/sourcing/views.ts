/**
 * Row -> contract view mappers for the sourcing bridge. Pure.
 *
 * Two audiences:
 * - ops (`SupplierOfferView`, `ApprovalView`, `SourcingJobView`): full supplier identity;
 * - buyers (`RouteOfferView`): never the supplier's name or platform ("customers never
 *   see Alibaba"), only region, verification, price, dates and the trust label.
 */
import { z } from 'zod';
import { IsoDateTime, SupplierId } from '../../contracts/common';
import { NegotiationStatus, SourcingDocumentKind, type ApprovalStatus, type Incoterm } from '../../contracts/enums';
import type { ApprovalView, RouteOfferView, SourcingJobView, SupplierOfferView } from '../../contracts/sourcing';
import type { approvals, sourcingDocuments, sourcingJobs, sourcingNegotiations, supplierOffers, suppliers } from '../db/schema';

export type JobRow = typeof sourcingJobs.$inferSelect;
export type OfferRow = typeof supplierOffers.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type NegotiationRow = typeof sourcingNegotiations.$inferSelect;
export type DocumentRow = typeof sourcingDocuments.$inferSelect;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export function toJobView(job: JobRow, counts: { offerCount: number; pendingApprovalCount: number }): SourcingJobView {
    return {
        id: job.id,
        displayId: job.displayId,
        buildId: job.buildId,
        buildDisplayId: job.request.build_display_id,
        partId: job.partId,
        designVersion: job.designVersion,
        status: job.status,
        channel: job.channel,
        request: job.request,
        leaseExpiresAt: isoOrNull(job.leaseExpiresAt),
        summary: job.summary,
        offerCount: counts.offerCount,
        pendingApprovalCount: counts.pendingApprovalCount,
        createdAt: iso(job.createdAt),
        updatedAt: iso(job.updatedAt),
    };
}

export function toSupplierOfferView(offer: OfferRow, supplier: SupplierRow): SupplierOfferView {
    return {
        id: offer.id,
        jobId: offer.jobId,
        supplier: { id: supplier.id, name: supplier.name, platform: supplier.platform, country: supplier.country, verified: supplier.verified },
        designVersion: offer.designVersion,
        quantity: offer.quantity,
        unitPriceCents: offer.unitPriceCents,
        toolingCents: offer.toolingCents,
        sampleCostCents: offer.sampleCostCents,
        shippingCents: offer.shippingCents,
        moq: offer.moq,
        productionLeadDays: offer.productionLeadDays,
        shippingLeadDays: offer.shippingLeadDays,
        incoterm: offer.incoterm,
        material: offer.material,
        processes: offer.processes,
        certificationsClaimed: offer.certificationsClaimed,
        exceptions: offer.exceptions,
        confidence: offer.confidence,
        negotiationStatus: offer.negotiationStatus,
        trustLevel: offer.trustLevel,
        status: offer.status,
        validUntil: isoOrNull(offer.validUntil),
        createdAt: iso(offer.createdAt),
    };
}

export function toApprovalView(a: ApprovalRow): ApprovalView {
    return {
        id: a.id,
        jobId: a.jobId,
        buildId: a.buildId,
        kind: a.kind,
        status: a.status,
        approverRole: a.approverRole,
        requestedBy: a.requestedBy,
        supplierId: a.supplierId,
        supplierOfferId: a.supplierOfferId,
        reason: a.reason,
        details: a.details,
        decidedBy: a.decidedBy,
        decisionNote: a.decisionNote,
        decidedAt: isoOrNull(a.decidedAt),
        expiresAt: isoOrNull(a.expiresAt),
        createdAt: iso(a.createdAt),
    };
}

// ---------------------------------------------------------------------------
// Buyer view
// ---------------------------------------------------------------------------

/** Incoterms whose price already includes delivery to the buyer's door. */
const DELIVERED_INCOTERMS: ReadonlySet<Incoterm> = new Set<Incoterm>(['DAP', 'DPU', 'DDP']);

let regionNames: Intl.DisplayNames | null = null;

/** "VN" -> "Vietnam" (falls back to the ISO code). */
export function countryName(code: string): string {
    try {
        regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
        return regionNames.of(code.toUpperCase()) ?? code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

/** "Verified partner · Vietnam" / "Partner · China". Never the supplier's name or platform. */
export function routeOfferLabel(supplier: Pick<SupplierRow, 'verified' | 'country'>): string {
    return `${supplier.verified ? 'Verified partner' : 'Partner'} · ${countryName(supplier.country)}`;
}

/** Server-side total in cents: unit × qty + tooling + shipping (when quoted). */
export function offerTotalCents(offer: Pick<OfferRow, 'unitPriceCents' | 'quantity' | 'toolingCents' | 'shippingCents'>): number {
    const total = offer.unitPriceCents * offer.quantity + offer.toolingCents + (offer.shippingCents ?? 0);
    if (!Number.isSafeInteger(total)) throw new Error(`Offer total overflows: ${total}`);
    return total;
}

export function toRouteOfferView(
    offer: OfferRow,
    supplier: Pick<SupplierRow, 'verified' | 'country'>,
    selection: { approvalId: string; status: ApprovalStatus } | null,
): RouteOfferView {
    return {
        id: offer.id,
        label: routeOfferLabel(supplier),
        country: supplier.country,
        verified: supplier.verified,
        quantity: offer.quantity,
        unitPriceCents: offer.unitPriceCents,
        toolingCents: offer.toolingCents,
        totalCents: offerTotalCents(offer),
        shippingIncluded: offer.shippingCents !== null || DELIVERED_INCOTERMS.has(offer.incoterm),
        totalLeadDays: offer.productionLeadDays + offer.shippingLeadDays,
        trustLevel: offer.trustLevel,
        exceptions: offer.exceptions,
        status: offer.status,
        selection,
    };
}

// ---------------------------------------------------------------------------
// Ops-only views without a frozen contract (sourcing desk detail)
// ---------------------------------------------------------------------------

export const SourcingNegotiationView = z.object({
    id: z.string(),
    supplierId: SupplierId,
    supplierName: z.string(),
    status: NegotiationStatus,
    notes: z.array(z.object({ at: IsoDateTime, status: z.string(), note: z.string() })),
    updatedAt: IsoDateTime,
});
export type SourcingNegotiationView = z.infer<typeof SourcingNegotiationView>;

export const SourcingDocumentView = z.object({
    id: z.string(),
    supplierId: SupplierId.nullable(),
    kind: SourcingDocumentKind,
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string(),
    uploadedBy: z.string(),
    createdAt: IsoDateTime,
    /** Signed GET URL for ops (15 min). */
    url: z.string().url(),
});
export type SourcingDocumentView = z.infer<typeof SourcingDocumentView>;

export function toNegotiationView(n: NegotiationRow, supplierName: string): SourcingNegotiationView {
    return { id: n.id, supplierId: n.supplierId, supplierName, status: n.status, notes: n.notes, updatedAt: iso(n.updatedAt) };
}

export function toDocumentView(d: DocumentRow, url: string): SourcingDocumentView {
    return {
        id: d.id,
        supplierId: d.supplierId,
        kind: d.kind,
        filename: d.filename,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        uploadedBy: d.uploadedBy,
        createdAt: iso(d.createdAt),
        url,
    };
}
