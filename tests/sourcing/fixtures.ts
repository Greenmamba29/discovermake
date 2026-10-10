/**
 * Fixtures for the sourcing suites: a quoted part (reusing the shop fixtures' analyzed
 * part + quote), a queued sourcing job for it, MCP clients, and offer inputs.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import type { Db } from '@/server/db';
import { parts, sourcingJobs } from '@/server/db/schema';
import { createSourcingClient } from '@/server/sourcing/clients';
import { createSourcingJob, leaseNextJob, type JobWriter } from '@/server/sourcing/jobs';
import { submitSupplier } from '@/server/sourcing/suppliers';
import type { SubmitOfferArgs } from '@/server/sourcing/offers';
import { createQuoteFixture, type QuoteFixtureOptions } from '../shop/fixtures';

export const ADMIN = { kind: 'admin', id: 'ops' } as const;
export const ADMIN_HEADERS = { authorization: 'Bearer test-admin-token' };
export const BASE = 'http://localhost:3100';

export const params = <P>(p: P) => ({ params: Promise.resolve(p) });

export function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return new Request(`${BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
}

export function quietConsole() {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/** A quoted part + a QUEUED accio job for it (priority keeps fixtures ahead of earlier leftovers). */
export async function createJobFixture(db: Db, opts: QuoteFixtureOptions & { targetUnitCostCents?: number; targetDeliveryDate?: string; priority?: number } = {}) {
    const q = await createQuoteFixture(db, opts);
    const { job } = await createSourcingJob({
        buildId: q.build.id,
        partId: q.part.id,
        quantity: q.quote.quantity,
        targetUnitCostCents: opts.targetUnitCostCents,
        targetDeliveryDate: opts.targetDeliveryDate,
        priority: opts.priority ?? 0,
        actor: ADMIN,
    });
    return { ...q, job };
}

export async function newClient(name = 'Accio test workspace') {
    return createSourcingClient(name);
}

/** Lease a specific job for `clientId` by making it the only high-priority job. */
export async function leaseJob(db: Db, jobId: string, clientId: string) {
    await db.update(sourcingJobs).set({ priority: 1000 }).where(eq(sourcingJobs.id, jobId));
    const lease = await leaseNextJob(clientId);
    await db.update(sourcingJobs).set({ priority: 0 }).where(eq(sourcingJobs.id, jobId));
    if (lease.job?.id !== jobId || !lease.leaseId) throw new Error(`expected to lease ${jobId}, got ${lease.job?.id}`);
    return { leaseId: lease.leaseId, writer: { kind: 'agent', clientId, leaseId: lease.leaseId } as JobWriter };
}

export async function supplierFor(jobId: string, writer: JobWriter, overrides: Partial<{ name: string; platform_ref: string; country: string; verified: boolean }> = {}) {
    const { supplier } = await submitSupplier(
        {
            sourcing_request_id: jobId,
            name: overrides.name ?? 'Example Precision Ltd.',
            platform: 'alibaba',
            platform_ref: overrides.platform_ref ?? `alibaba-${randomUUID().slice(0, 8)}`,
            country: overrides.country ?? 'VN',
            verified: overrides.verified ?? true,
            capabilities: ['laser cutting'],
            evidence: [{ kind: 'verified_badge', note: 'Verified Supplier badge on profile' }],
        },
        writer,
    );
    return supplier;
}

export function offerInput(jobId: string, supplierId: string, overrides: Partial<SubmitOfferArgs> = {}): SubmitOfferArgs {
    return {
        sourcing_request_id: jobId,
        idempotency_key: `${supplierId}-r1`,
        supplier_id: supplierId,
        design_version: 1,
        quantity: 10,
        currency: 'usd',
        unit_price_cents: 700,
        tooling_cents: 0,
        sample_cost_cents: null,
        shipping_cents: 2500,
        moq: 10,
        production_lead_days: 10,
        shipping_lead_days: 6,
        incoterm: 'DDP',
        material: 'Aluminum 5052-H32, 1.6 mm',
        processes: ['Fiber laser cutting'],
        certifications_claimed: [],
        exceptions: [],
        source_evidence: [],
        attachment_ids: [],
        confidence: 0.9,
        negotiation_status: 'supplier-confirmed',
        valid_until: null,
        ...overrides,
    };
}

/** Bump a part's design version (as a re-upload would). */
export async function bumpDesignVersion(db: Db, partId: string) {
    const [p] = await db.select().from(parts).where(eq(parts.id, partId));
    await db.update(parts).set({ designVersion: p.designVersion + 1 }).where(eq(parts.id, partId));
}
