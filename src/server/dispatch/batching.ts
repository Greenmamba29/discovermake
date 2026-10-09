/**
 * Dispatch batching (backlog 700-11): group compatible open jobs at a shop so they share setup
 * (one program, one sheet load). Compatible = same shop, material, thickness and process, with
 * ship windows that still overlap. Heuristic: first-fit decreasing by sheet area, bins of one
 * stock sheet at NEST_UTILIZATION. Deterministic: same jobs in, same batches and ids out.
 *
 * OR-Tools is not available in this TypeScript stack. `planBatches` sits behind the
 * `BatchPlanner` interface, so a solver service (CP-SAT bin packing with time windows) can replace
 * the heuristic without touching callers.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { manufacturingJobs, materials, thicknessOptions } from '../db/schema';

export type BatchJob = {
    id: string;
    shopId: string;
    materialId: string;
    thicknessOptionId: string;
    processId: string;
    /** Sheet area the job consumes (part bounding box x quantity), mm². */
    areaMm2: number;
    /** Ship window: earliest start and latest ship date (YYYY-MM-DD). */
    windowStart: string;
    windowEnd: string;
};

export type Batch = {
    id: string;
    shopId: string;
    key: string;
    jobIds: string[];
    areaMm2: number;
    /** Intersection of the members' ship windows. */
    windowStart: string;
    windowEnd: string;
};

export type BatchPlanOptions = {
    /** Usable area of one stock sheet for a compatibility key (material/thickness). */
    sheetAreaMm2: (job: BatchJob) => number;
    utilization?: number;
};

export interface BatchPlanner {
    plan(jobs: readonly BatchJob[], opts: BatchPlanOptions): Batch[];
}

export const NEST_UTILIZATION = 0.85;

export function compatibilityKey(j: Pick<BatchJob, 'shopId' | 'materialId' | 'thicknessOptionId' | 'processId'>): string {
    return `${j.shopId}|${j.materialId}|${j.thicknessOptionId}|${j.processId}`;
}

/** Deterministic batch id from its member job ids. */
export function batchIdFor(jobIds: readonly string[]): string {
    return `bat_${createHash('sha256').update([...jobIds].sort().join(',')).digest('hex').slice(0, 20)}`;
}

/**
 * First-fit decreasing. Only batches of two or more jobs are returned (a single job is not a
 * batch). Jobs that alone exceed a sheet never batch.
 */
export function planBatches(jobs: readonly BatchJob[], opts: BatchPlanOptions): Batch[] {
    const utilization = opts.utilization ?? NEST_UTILIZATION;
    const groups = new Map<string, BatchJob[]>();
    for (const j of jobs) {
        if (!(j.areaMm2 >= 0) || j.windowEnd < j.windowStart) continue;
        const key = compatibilityKey(j);
        const g = groups.get(key) ?? [];
        g.push(j);
        groups.set(key, g);
    }
    const out: Batch[] = [];
    for (const key of [...groups.keys()].sort()) {
        const group = [...(groups.get(key) ?? [])].sort((a, b) => b.areaMm2 - a.areaMm2 || a.id.localeCompare(b.id));
        const capacity = opts.sheetAreaMm2(group[0]) * utilization;
        const bins: { jobs: BatchJob[]; area: number; start: string; end: string }[] = [];
        for (const job of group) {
            if (job.areaMm2 > capacity) continue;
            const bin = bins.find((b) => b.area + job.areaMm2 <= capacity && job.windowStart <= b.end && b.start <= job.windowEnd);
            if (bin) {
                bin.jobs.push(job);
                bin.area += job.areaMm2;
                bin.start = bin.start > job.windowStart ? bin.start : job.windowStart;
                bin.end = bin.end < job.windowEnd ? bin.end : job.windowEnd;
            } else {
                bins.push({ jobs: [job], area: job.areaMm2, start: job.windowStart, end: job.windowEnd });
            }
        }
        for (const b of bins) {
            if (b.jobs.length < 2) continue;
            const jobIds = b.jobs.map((j) => j.id).sort();
            out.push({ id: batchIdFor(jobIds), shopId: b.jobs[0].shopId, key, jobIds, areaMm2: b.area, windowStart: b.start, windowEnd: b.end });
        }
    }
    return out;
}

export const firstFitDecreasing: BatchPlanner = { plan: planBatches };

const DEFAULT_SHEET_AREA_MM2 = 1219 * 2438;
/** Jobs that have not started cutting yet can still share a setup. */
export const BATCHABLE_JOB_STATUSES = ['OFFERED', 'ACCEPTED'] as const;

/** Batch ids for a shop's open (not yet started) manufacturing jobs. Receiving jobs never batch. */
export async function openJobBatchIds(db: DbOrTx, shopId: string, planner: BatchPlanner = firstFitDecreasing): Promise<Map<string, string>> {
    const rows = await db
        .select()
        .from(manufacturingJobs)
        .where(and(eq(manufacturingJobs.shopId, shopId), inArray(manufacturingJobs.status, [...BATCHABLE_JOB_STATUSES])));
    const jobs: BatchJob[] = rows
        .filter((r) => !r.packet.receiving)
        .map((r) => ({
            id: r.id,
            shopId: r.shopId,
            materialId: r.packet.material.id,
            thicknessOptionId: r.packet.material.thicknessOptionId,
            processId: r.packet.process.id,
            areaMm2: r.packet.part.bboxWidthMm * r.packet.part.bboxHeightMm * r.packet.quantity,
            windowStart: (r.acceptedAt ?? r.offeredAt).toISOString().slice(0, 10),
            windowEnd: r.packet.shipBy,
        }));
    if (jobs.length < 2) return new Map();
    const thicknessIds = [...new Set(jobs.map((j) => j.thicknessOptionId))];
    const sheets = await db
        .select({ id: thicknessOptions.id, w: materials.sheetWidthMm, h: materials.sheetHeightMm })
        .from(thicknessOptions)
        .innerJoin(materials, eq(materials.id, thicknessOptions.materialId))
        .where(inArray(thicknessOptions.id, thicknessIds));
    const area = new Map(sheets.map((s) => [s.id, s.w && s.h ? s.w * s.h : DEFAULT_SHEET_AREA_MM2]));
    const batches = planner.plan(jobs, { sheetAreaMm2: (j) => area.get(j.thicknessOptionId) ?? DEFAULT_SHEET_AREA_MM2 });
    const out = new Map<string, string>();
    for (const b of batches) for (const id of b.jobIds) out.set(id, b.id);
    return out;
}
