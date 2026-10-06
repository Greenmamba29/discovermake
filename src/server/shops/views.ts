/**
 * Shop Console view builders (contracts in src/contracts/shop.ts). Read-only.
 */
import { asc, desc, eq } from 'drizzle-orm';
import type { JobStatus } from '../../contracts/enums';
import type { InspectionPlanView, InspectionResultView, MilestoneView, ShopJobDetail, ShopJobSummary, ShopNextAction } from '../../contracts/shop';
import type { DbOrTx } from '../db';
import { inspectionPlans, inspectionResults, manufacturingJobs, parts, productionMilestones, shipments } from '../db/schema';
import { packetForConsole } from '../dispatch/packet';
import { toShipmentView } from '../shipping/views';

export type JobRow = typeof manufacturingJobs.$inferSelect;

export const MILESTONE_LABELS = {
    MATERIAL_STAGED: 'Material staged',
    CUTTING: 'Cutting',
    BENDING: 'Bending',
    FINISHING: 'Finishing',
    QA: 'Quality check',
    PACKED: 'Packed',
} as const;

const iso = (d: Date) => d.toISOString();

export function nextActionFor(status: JobStatus): ShopNextAction {
    switch (status) {
        case 'OFFERED':
            return 'ACCEPT_OR_DECLINE';
        case 'ACCEPTED':
            return 'RECORD_MILESTONE';
        case 'IN_PRODUCTION':
            return 'SUBMIT_INSPECTION';
        case 'QA_PASSED':
            return 'CREATE_SHIPMENT';
        default:
            return 'NONE';
    }
}

export function toJobSummary(job: JobRow): ShopJobSummary {
    const p = job.packet;
    return {
        id: job.id,
        orderId: job.orderId,
        orderNumber: p.orderNumber,
        buildDisplayId: p.buildDisplayId,
        status: job.status,
        isRework: !!job.reworkOfJobId,
        partFilename: p.part.filename,
        materialName: p.material.name,
        thicknessLabel: p.material.thicknessLabel,
        finishName: p.finish ? (p.finish.colorName ? `${p.finish.name} · ${p.finish.colorName}` : p.finish.name) : null,
        quantity: p.quantity,
        shipBy: p.shipBy,
        offerExpiresAt: job.status === 'OFFERED' && job.offerExpiresAt ? iso(job.offerExpiresAt) : null,
        payoutCents: job.payoutCents,
        nextAction: nextActionFor(job.status),
        createdAt: iso(job.createdAt),
    };
}

export function toMilestoneView(m: typeof productionMilestones.$inferSelect): MilestoneView {
    return { id: m.id, jobId: m.jobId, kind: m.kind, label: MILESTONE_LABELS[m.kind], note: m.note, occurredAt: iso(m.occurredAt) };
}

export function toInspectionResultView(r: typeof inspectionResults.$inferSelect): InspectionResultView {
    return {
        id: r.id,
        planId: r.planId,
        jobId: r.jobId,
        outcome: r.outcome,
        measurements: r.measurements,
        photoCount: r.photoKeys.length,
        inspectorName: r.inspectorName,
        notes: r.notes,
        reworkJobId: r.reworkJobId,
        createdAt: iso(r.createdAt),
    };
}

export function toInspectionPlanView(p: typeof inspectionPlans.$inferSelect): InspectionPlanView {
    return { id: p.id, jobId: p.jobId, checks: p.checks, sampleSize: p.sampleSize, createdAt: iso(p.createdAt) };
}

/** Full job detail for the console (packet redacted until ACCEPTED, fresh signed file URL after). */
export async function buildJobDetail(db: DbOrTx, job: JobRow): Promise<ShopJobDetail> {
    const [[part], milestones, [plan], results, [shipment]] = await Promise.all([
        db.select({ fileKey: parts.fileKey, filename: parts.filename, preview: parts.preview }).from(parts).where(eq(parts.id, job.partId)),
        db.select().from(productionMilestones).where(eq(productionMilestones.jobId, job.id)).orderBy(asc(productionMilestones.occurredAt)),
        db.select().from(inspectionPlans).where(eq(inspectionPlans.jobId, job.id)),
        db.select().from(inspectionResults).where(eq(inspectionResults.jobId, job.id)).orderBy(desc(inspectionResults.createdAt)),
        db.select().from(shipments).where(eq(shipments.jobId, job.id)).orderBy(desc(shipments.createdAt)).limit(1),
    ]);
    if (!part) throw new Error(`Job ${job.id} references missing part ${job.partId}`);
    return {
        ...toJobSummary(job),
        packet: await packetForConsole(job.packet, job.status, part),
        preview: part.preview ?? null,
        milestones: milestones.map(toMilestoneView),
        inspectionPlan: plan ? toInspectionPlanView(plan) : null,
        inspectionResults: results.map(toInspectionResultView),
        shipment: shipment ? toShipmentView(shipment, { includeLabel: true }) : null,
        declineReason: job.declineReason,
        acceptedAt: job.acceptedAt ? iso(job.acceptedAt) : null,
    };
}
