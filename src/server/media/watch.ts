/**
 * Watch My Build (workflow 09): the buyer's own production stream.
 *
 * Every Shop Console step auto-posts to the order's stream: it is read straight from the
 * production records the console writes (job accepted, each milestone with its shop photos,
 * inspection, shipment, delivery), so nothing can be posted that did not happen. When the
 * shop's channel has a `build_live` show featuring this build (live or about to start), it is
 * embedded; without one the milestone photos stand in (no unrestricted surveillance: cameras
 * are the shop's own approved shows).
 *
 * Access: the signed order link token, or the signed-in buyer (or staff). Anything else is 404.
 */
import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { MilestoneKind } from '../../contracts/enums';
import type { WatchMyBuildView, WatchPost, WatchPostKind } from '../../contracts/media';
import { verifyOrderAccessToken } from '../auth/order-link';
import { isStaff, type ViewerContext } from '../auth/viewer';
import { getDb } from '../db';
import { builds, channels, inspectionResults, manufacturingJobs, orders, productionMilestones, shipments, showFeaturedBuilds, shops, shows } from '../db/schema';
import { videoSourceFor } from '../live/views';
import { getStorage } from '../storage';

const MILESTONE_POST: Record<MilestoneKind, { kind: WatchPostKind; label: string }> = {
    MATERIAL_STAGED: { kind: 'material_staged', label: 'Material staged at the machine' },
    CUTTING: { kind: 'cutting', label: 'Cutting started' },
    BENDING: { kind: 'bending', label: 'Bending on the press brake' },
    FINISHING: { kind: 'finishing', label: 'Finishing' },
    QA: { kind: 'qa', label: 'Inspection started' },
    PACKED: { kind: 'packed', label: 'Packed for shipping' },
};

const IN_PRODUCTION = new Set(['ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED']);

async function signedPhotos(keys: string[]): Promise<string[]> {
    const storage = getStorage();
    const out: string[] = [];
    for (const key of keys.slice(0, 6)) {
        try {
            out.push((await storage.getSignedUrl(key, { method: 'GET', expiresInSeconds: 900 })).url);
        } catch {
            // a missing photo never hides the step
        }
    }
    return out;
}

export async function watchMyBuild(orderId: string, auth: { token: string | null; viewer: ViewerContext | null }): Promise<WatchMyBuildView | null> {
    const db = getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return null;
    const allowed = verifyOrderAccessToken(order.id, auth.token, order.accessTokenHash) || (!!auth.viewer && (order.buyerUserId === auth.viewer.user.id || isStaff(auth.viewer)));
    if (!allowed) return null;

    const [[build], jobs, milestones, inspections, shipmentRows] = await Promise.all([
        db.select({ id: builds.id, name: builds.name }).from(builds).where(eq(builds.id, order.buildId)),
        db.select().from(manufacturingJobs).where(eq(manufacturingJobs.orderId, order.id)).orderBy(asc(manufacturingJobs.createdAt)),
        db.select().from(productionMilestones).where(eq(productionMilestones.orderId, order.id)).orderBy(asc(productionMilestones.occurredAt)),
        db.select().from(inspectionResults).where(eq(inspectionResults.orderId, order.id)).orderBy(asc(inspectionResults.createdAt)),
        db.select().from(shipments).where(eq(shipments.orderId, order.id)).orderBy(desc(shipments.createdAt)),
    ]);
    const shopIds = [...new Set([order.shopId, ...jobs.map((j) => j.shopId)].filter((s): s is string => !!s))];
    const shopRows = shopIds.length ? await db.select({ id: shops.id, name: shops.name }).from(shops).where(inArray(shops.id, shopIds)) : [];
    const shopName = (id: string | null) => shopRows.find((s) => s.id === id)?.name ?? 'the shop';

    const posts: WatchPost[] = [];
    if (order.paidAt) posts.push({ id: `paid:${order.id}`, kind: 'paid', label: 'Payment confirmed · production authorized', note: null, at: order.paidAt.toISOString(), actor: 'system', photoUrls: [] });
    for (const j of jobs) {
        if (j.acceptedAt) posts.push({ id: `accepted:${j.id}`, kind: 'accepted', label: `Accepted by ${shopName(j.shopId)}`, note: j.reworkOfJobId ? 'Rework job' : null, at: j.acceptedAt.toISOString(), actor: 'shop', photoUrls: [] });
    }
    for (const m of milestones) {
        const meta = MILESTONE_POST[m.kind];
        posts.push({ id: m.id, kind: meta.kind, label: meta.label, note: m.note, at: m.occurredAt.toISOString(), actor: 'shop', photoUrls: await signedPhotos(m.photoKeys ?? []) });
    }
    for (const r of inspections) {
        posts.push({
            id: r.id,
            kind: r.outcome === 'PASS' ? 'qa_passed' : 'qa_failed',
            label: r.outcome === 'PASS' ? 'QA passed' : 'QA found an issue · the shop is reworking it',
            note: r.notes,
            at: r.createdAt.toISOString(),
            actor: 'shop',
            photoUrls: await signedPhotos(r.photoKeys ?? []),
        });
    }
    for (const s of shipmentRows) {
        posts.push({ id: s.id, kind: 'shipped', label: `Shipped with ${s.carrier} ${s.service}`.trim(), note: s.trackingNumber ? `Tracking ${s.trackingNumber}` : null, at: (s.shippedAt ?? s.createdAt).toISOString(), actor: 'carrier', photoUrls: [] });
    }
    if (order.deliveredAt) posts.push({ id: `delivered:${order.id}`, kind: 'delivered', label: 'Delivered', note: null, at: order.deliveredAt.toISOString(), actor: 'carrier', photoUrls: [] });
    posts.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

    // A camera on the shop's channel: a build_live show featuring this build, live or upcoming.
    let camera: WatchMyBuildView['camera'] = null;
    const activeShop = order.shopId ?? jobs[jobs.length - 1]?.shopId ?? null;
    if (activeShop) {
        const shopChannels = await db.select().from(channels).where(eq(channels.shopId, activeShop));
        if (shopChannels.length) {
            const candidates = await db
                .select()
                .from(shows)
                .where(and(inArray(shows.channelId, shopChannels.map((c) => c.id)), eq(shows.format, 'build_live'), inArray(shows.status, ['LIVE', 'SCHEDULED'])))
                .orderBy(desc(shows.scheduledFor))
                .limit(20);
            const featuring = candidates.length
                ? new Set((await db.select({ showId: showFeaturedBuilds.showId }).from(showFeaturedBuilds).where(and(inArray(showFeaturedBuilds.showId, candidates.map((c) => c.id)), eq(showFeaturedBuilds.buildId, order.buildId)))).map((r) => r.showId))
                : new Set<string>();
            const linked = candidates.filter((s) => featuring.has(s.id) || s.featuredBuildId === order.buildId);
            const pick = linked.find((s) => s.status === 'LIVE') ?? linked[0];
            if (pick) {
                const channel = shopChannels.find((c) => c.id === pick.channelId)!;
                camera = { showId: pick.id, title: pick.title, status: pick.status, source: videoSourceFor(pick), channelName: channel.name };
            }
        }
    }

    return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        buildId: order.buildId,
        buildTitle: build?.name ?? 'Your build',
        shopName: activeShop ? shopName(activeShop) : null,
        posts,
        camera,
        inProduction: IN_PRODUCTION.has(order.status),
    };
}
