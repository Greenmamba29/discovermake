/**
 * Buyer side of sourcing (`/api/builds/:buildId/sourcing`): "Finding manufacturing
 * partners…" and the supplier offers on the Manufacturing Route.
 *
 * Buyers never see who the supplier is (name, platform): offers are `RouteOfferView`s
 * labelled by region and verification, with totals computed here in cents.
 */
import { desc, eq } from 'drizzle-orm';
import type { BuildSourcingView, CreateSourcingRequest, RouteOfferView } from '../../contracts/sourcing';
import { getDb } from '../db';
import { builds, sourcingJobs } from '../db/schema';
import { buyerActor } from '../quote/parts';
import { requestOfferSelection } from './approvals';
import { notFound } from './errors';
import { createSourcingJob } from './jobs';
import { getRouteOffer, listRouteOffers } from './offers';
import type { JobRow } from './views';

export type BuyerJobSummary = BuildSourcingView['jobs'][number];

export function toBuyerJobSummary(job: JobRow): BuyerJobSummary {
    return { id: job.id, displayId: job.displayId, status: job.status, designVersion: job.designVersion, quantity: job.request.quantity, createdAt: job.createdAt.toISOString() };
}

async function assertBuild(buildId: string): Promise<void> {
    const [b] = await getDb().select({ id: builds.id }).from(builds).where(eq(builds.id, buildId));
    if (!b) throw notFound('Build');
}

export async function getBuildSourcingView(buildId: string): Promise<BuildSourcingView> {
    await assertBuild(buildId);
    const jobs = await getDb().select().from(sourcingJobs).where(eq(sourcingJobs.buildId, buildId)).orderBy(desc(sourcingJobs.createdAt)).limit(50);
    return { buildId, jobs: jobs.map(toBuyerJobSummary), offers: await listRouteOffers(buildId) };
}

/** "Find manufacturing partners": queue a job (or return the open one for the same part/version/quantity). */
export async function requestBuyerSourcing(buildId: string, body: CreateSourcingRequest): Promise<{ job: BuyerJobSummary; created: boolean }> {
    const { job, created } = await createSourcingJob({ ...body, buildId, actor: buyerActor(buildId), channel: 'accio', reuseOpen: true });
    return { job: toBuyerJobSummary(job), created };
}

/** "Choose this route": a PENDING SELECT_SUPPLIER_OFFER approval for ops. Returns the buyer-safe offer with its selection. */
export async function selectRouteOffer(buildId: string, offerId: string): Promise<{ offer: RouteOfferView; created: boolean }> {
    const { created } = await requestOfferSelection({ buildId, offerId, actor: buyerActor(buildId) });
    const offer = await getRouteOffer(offerId);
    if (!offer) throw notFound('Offer');
    return { offer, created };
}
