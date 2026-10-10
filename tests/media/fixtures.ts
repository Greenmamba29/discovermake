/**
 * Fixtures for Media suites: a creator owning a build with an orderable BINDING quote, derived
 * builds (remix / clone) with their own quotes, and paid orders through the real checkout +
 * dev payment pipeline.
 */
import { eq } from 'drizzle-orm';
import type { PublishBuildRequest } from '@/contracts/media';
import type { Db } from '@/server/db';
import { builds } from '@/server/db/schema';
import { publishBuild } from '@/server/media';
import { confirmDevPayment, createCheckout } from '@/server/orders';
import { checkoutBody, createQuoteFixture, type QuoteFixtureOptions } from '../orders/fixtures';
import { makeUser, viewerOf, type TestUser } from '../live/fixtures';

export async function creatorBuild(db: Db, opts: { quote?: QuoteFixtureOptions; name?: string } = {}) {
    const creator = await makeUser('creator', ['buyer', 'creator'], opts.name ?? 'Amanda Maker');
    const viewer = await viewerOf(creator);
    const fixture = await createQuoteFixture(db, opts.quote);
    await db.update(builds).set({ ownerUserId: creator.id, name: 'Walnut desk lamp plate' }).where(eq(builds.id, fixture.build.id));
    return { creator, viewer, fixture };
}

export async function publish(viewer: Awaited<ReturnType<typeof viewerOf>>, buildId: string, input: Partial<PublishBuildRequest> = {}) {
    return publishBuild(viewer, buildId, { visibility: 'public', license: 'commercial', royaltyPct: 10, tags: [], ...input });
}

/** A build forked from `parentId` (as remix / clone would) with its own orderable quote. */
export async function derivedBuild(db: Db, parentId: string, origin: 'remix' | 'clone', ownerUserId: string | null, quote: QuoteFixtureOptions = {}) {
    const fixture = await createQuoteFixture(db, quote);
    await db.update(builds).set({ derivedFromBuildId: parentId, origin, ownerUserId, name: `Lamp plate (${origin})` }).where(eq(builds.id, fixture.build.id));
    return fixture;
}

/** Checkout + dev payment succeeded (the same pipeline as a Stripe webhook). */
export async function paidOrder(quoteId: string, buyer?: TestUser) {
    const res = await createCheckout(checkoutBody(quoteId, buyer ? { buyer: { email: buyer.email, name: 'Ada Buyer' } } : {}), { buyerUserId: buyer?.id ?? null });
    await confirmDevPayment(JSON.stringify({ providerRef: res.payment.providerRef, outcome: 'succeeded' }), new Headers());
    return { orderId: res.orderId, token: new URL(res.orderUrl).searchParams.get('t')!, res };
}
