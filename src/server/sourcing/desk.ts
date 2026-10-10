/**
 * Ops sourcing desk (`/api/admin/sourcing/**`, auth: Bearer ADMIN_TOKEN in the routes).
 *
 * Request schemas that have no frozen contract live here, plus the job detail read.
 * The desk is also the fallback channel (ADR-0005): ops can register suppliers and
 * offers for a job without the MCP channel, with the same validation and no lease.
 */
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { BuildId } from '../../contracts/common';
import { SourcingChannel, SourcingJobStatus, ApprovalStatus, ApproverRole } from '../../contracts/enums';
import { CreateSourcingRequest, SubmitOfferInput, SubmitSupplierInput, type ApprovalView, type SourcingJobView, type SupplierOfferView } from '../../contracts/sourcing';
import type { SupplierLegOpsView } from '../../contracts/promise';
import { getDb } from '../db';
import { sourcingDocuments, sourcingNegotiations, suppliers } from '../db/schema';
import { getStorage } from '../storage';
import { listApprovals } from './approvals';
import { SIGNED_URL_TTL_SECONDS } from './constants';
import { getJobView } from './jobs';
import { listJobOffers } from './offers';
import { toDocumentView, toNegotiationView, type SourcingDocumentView, type SourcingNegotiationView } from './views';

/** POST /api/admin/sourcing/jobs: CreateSourcingRequest & { buildId, channel? }. */
export const AdminCreateSourcingJobRequest = CreateSourcingRequest.extend({ buildId: BuildId, channel: SourcingChannel.optional() });

/** POST /api/admin/sourcing/jobs/:jobId/requeue (optional body). */
export const RequeueSourcingJobRequest = z.object({ channel: SourcingChannel.optional() });

/** POST /api/admin/sourcing/jobs/:jobId/cancel (optional body). */
export const CancelSourcingJobRequest = z.object({ reason: z.string().trim().max(500).optional() });

/** Desk writes: the agent inputs without the lease fields (the job id comes from the path). */
export const DeskSubmitSupplierRequest = SubmitSupplierInput.omit({ sourcing_request_id: true, lease_id: true });
export const DeskSubmitOfferRequest = SubmitOfferInput.omit({ sourcing_request_id: true, lease_id: true });

const csv = <T extends z.ZodTypeAny>(item: T) =>
    z
        .string()
        .optional()
        .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
        .pipe(z.array(item).optional());

export const ListSourcingJobsQuery = z.object({ status: csv(SourcingJobStatus), channel: SourcingChannel.optional(), buildId: BuildId.optional() });
export const ListApprovalsQuery = z.object({ status: csv(ApprovalStatus), role: ApproverRole.optional() });

export type SourcingJobDetail = {
    job: SourcingJobView;
    offers: SupplierOfferView[];
    approvals: ApprovalView[];
    negotiations: SourcingNegotiationView[];
    documents: SourcingDocumentView[];
    /** R3: supplier fulfilment legs (purchase orders) created from this job's offers. */
    legs: SupplierLegOpsView[];
};

export async function getSourcingJobDetail(jobId: string): Promise<SourcingJobDetail | null> {
    const job = await getJobView(jobId);
    if (!job) return null;
    const db = getDb();
    const negotiations = await db
        .select({ n: sourcingNegotiations, supplierName: suppliers.name })
        .from(sourcingNegotiations)
        .innerJoin(suppliers, eq(suppliers.id, sourcingNegotiations.supplierId))
        .where(eq(sourcingNegotiations.jobId, jobId))
        .orderBy(asc(sourcingNegotiations.createdAt));
    const docs = await db.select().from(sourcingDocuments).where(eq(sourcingDocuments.jobId, jobId)).orderBy(asc(sourcingDocuments.createdAt));
    const storage = getStorage();
    const documents = await Promise.all(
        docs.map(async (d) => toDocumentView(d, (await storage.getSignedUrl(d.fileKey, { method: 'GET', expiresInSeconds: SIGNED_URL_TTL_SECONDS, downloadFilename: d.filename })).url)),
    );
    return {
        job,
        offers: await listJobOffers(jobId),
        approvals: await listApprovals({ jobId }),
        negotiations: negotiations.map((r) => toNegotiationView(r.n, r.supplierName)),
        documents,
        legs: await (await import('../prime/views')).legsForJob(jobId, db),
    };
}
