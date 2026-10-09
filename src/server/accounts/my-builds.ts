/**
 * My Builds (workflow 09, 500-1 / 500-4) and Reorder.
 *
 * Scope:
 *   - signed in: builds the user owns (incl. claimed guest builds) and builds behind the
 *     user's orders; Following = builds the user follows;
 *   - guest: this device's unclaimed builds (Following needs an account).
 * Tabs: created = origin upload | make_ai; remixed = remix | clone; ordered = has a
 * placed order (payment not pending/failed); all = created ∪ remixed.
 */
import { and, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { MyBuildRow, MyBuildsResponse, MyBuildsTab, ReorderResponse } from '../../contracts/account';
import { MY_BUILDS_TABS } from '../../contracts/account';
import type { OrderStatus } from '../../contracts/enums';
import { getDb, type DbOrTx } from '../db';
import { builds, designVersions, orders, parts, quotes } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../http';
import { deriveBuildTrustState } from '../build-graph/trust';
import { createQuote } from '../quote';
import { canEditBuild, type ViewerContext } from '../auth/viewer';

/** Orders that never became a purchase do not count as "ordered" and cannot be reordered. */
const UNPLACED: OrderStatus[] = ['PENDING_PAYMENT', 'PAYMENT_FAILED'];
const UNPLACED_SQL = sql.raw(UNPLACED.map((s) => `'${s}'`).join(', '));

export type BuildsPrincipal = { viewer: ViewerContext | null; deviceHash: string | null };

type Conditions = Record<MyBuildsTab, SQL>;

function conditions(p: BuildsPrincipal): Conditions | null {
    const created = sql`${builds.origin} in ('upload', 'make_ai')`;
    const remixed = sql`${builds.origin} in ('remix', 'clone')`;
    const placed = sql`exists (select 1 from orders o where o.build_id = ${builds.id} and o.status not in (${UNPLACED_SQL}))`;
    let mine: SQL;
    let following: SQL;
    if (p.viewer) {
        const uid = p.viewer.user.id;
        mine = sql`(${builds.ownerUserId} = ${uid} or exists (select 1 from orders o where o.build_id = ${builds.id} and o.buyer_user_id = ${uid}))`;
        following = sql`exists (select 1 from build_follows f where f.build_id = ${builds.id} and f.user_id = ${uid})`;
    } else if (p.deviceHash) {
        mine = sql`(${builds.deviceHash} = ${p.deviceHash} and ${builds.ownerUserId} is null)`;
        following = sql`false`;
    } else {
        return null;
    }
    return {
        all: mine,
        created: sql`(${mine} and ${created})`,
        remixed: sql`(${mine} and ${remixed})`,
        ordered: sql`(${mine} and ${placed})`,
        following,
    };
}

const zeroCounts = (): Record<MyBuildsTab, number> => Object.fromEntries(MY_BUILDS_TABS.map((t) => [t, 0])) as Record<MyBuildsTab, number>;

export async function listMyBuilds(p: BuildsPrincipal, tab: MyBuildsTab, limit = 50, db: DbOrTx = getDb()): Promise<MyBuildsResponse> {
    const guest = !p.viewer;
    const c = conditions(p);
    if (!c) return { tab, rows: [], counts: zeroCounts(), guest };

    const [countRow] = await db
        .select({
            all: sql<number>`count(*) filter (where ${c.all})::int`,
            created: sql<number>`count(*) filter (where ${c.created})::int`,
            remixed: sql<number>`count(*) filter (where ${c.remixed})::int`,
            ordered: sql<number>`count(*) filter (where ${c.ordered})::int`,
            following: sql<number>`count(*) filter (where ${c.following})::int`,
        })
        .from(builds)
        .where(sql`(${c.all} or ${c.following})`);
    const counts = { ...zeroCounts(), ...countRow };

    const rows = await db.select().from(builds).where(c[tab]).orderBy(desc(builds.updatedAt), desc(builds.id)).limit(limit);
    if (!rows.length) return { tab, rows: [], counts, guest };
    const ids = rows.map((r) => r.id);

    const partRows = await db
        .select({ id: parts.id, buildId: parts.buildId, status: parts.status, preview: parts.preview, createdAt: parts.createdAt })
        .from(parts)
        .where(inArray(parts.buildId, ids))
        .orderBy(desc(parts.createdAt));
    const partFor = new Map<string, (typeof partRows)[number]>();
    for (const part of partRows) {
        const seen = partFor.get(part.buildId);
        if (!seen || (seen.status !== 'READY' && part.status === 'READY')) partFor.set(part.buildId, part);
    }

    const orderRows = await db
        .select({ id: orders.id, buildId: orders.buildId, orderNumber: orders.orderNumber, status: orders.status, quoteId: orders.quoteId, createdAt: orders.createdAt })
        .from(orders)
        .where(and(inArray(orders.buildId, ids), notInArray(orders.status, UNPLACED)))
        .orderBy(desc(orders.createdAt));
    const orderFor = new Map<string, (typeof orderRows)[number]>();
    for (const o of orderRows) if (!orderFor.has(o.buildId)) orderFor.set(o.buildId, o);

    const approved = new Set(
        (
            await db
                .select({ buildId: designVersions.buildId })
                .from(designVersions)
                .where(and(inArray(designVersions.buildId, ids), eq(designVersions.status, 'APPROVED')))
        ).map((r) => r.buildId),
    );

    const out: MyBuildRow[] = await Promise.all(
        rows.map(async (b) => {
            const part = partFor.get(b.id) ?? null;
            const order = orderFor.get(b.id) ?? null;
            return {
                buildId: b.id,
                displayId: b.displayId,
                name: b.name,
                origin: b.origin,
                status: b.status,
                trustState: await deriveBuildTrustState(b, db).catch(() => null),
                currentVersion: b.currentVersion,
                partId: part?.id ?? null,
                previewSvg: part?.preview?.svgPath ?? null,
                previewSize: part?.preview ? { widthMm: part.preview.widthMm, heightMm: part.preview.heightMm } : null,
                derivedFromBuildId: b.derivedFromBuildId,
                lastOrder: order ? { orderId: order.id, orderNumber: order.orderNumber, status: order.status, quoteId: order.quoteId, placedAt: order.createdAt.toISOString() } : null,
                actions: { reorder: !!order && !!part, remix: approved.has(b.id), repair: !!order && !!part },
                updatedAt: b.updatedAt.toISOString(),
            } satisfies MyBuildRow;
        }),
    );
    return { tab, rows: out, counts, guest };
}

/**
 * Reorder: a fresh quote with the last order's selections. Allowed for whoever may edit
 * the build, or for the signed-in buyer of an order on it (then their own last order is used).
 */
export async function reorderBuild(p: BuildsPrincipal, buildId: string, db: DbOrTx = getDb()): Promise<ReorderResponse> {
    const [build] = await db.select().from(builds).where(eq(builds.id, buildId));
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    const placed = and(eq(orders.buildId, buildId), notInArray(orders.status, UNPLACED));
    let where = placed;
    if (!(await canEditBuild(p, build))) {
        if (!p.viewer) throw new ApiError('FORBIDDEN', 'Sign in with the account that ordered this build to reorder it.', 403);
        where = and(placed, eq(orders.buyerUserId, p.viewer.user.id));
        const [mine] = await db.select({ id: orders.id }).from(orders).where(where).limit(1);
        if (!mine) throw new ApiError('FORBIDDEN', 'Only the owner or buyer of this build can reorder it.', 403);
    }
    const [last] = await db
        .select({ config: quotes.config })
        .from(orders)
        .innerJoin(quotes, eq(quotes.id, orders.quoteId))
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(1);
    if (!last) throw new ApiError('CONFLICT', 'Order this build once before you reorder it.', 409);
    let quote;
    try {
        quote = await createQuote(last.config);
    } catch (err) {
        if (err instanceof ApiError && (err.status === 400 || err.status === 404 || err.status === 409)) {
            throw new ApiError('CONFLICT', 'This part no longer quotes with the options you ordered. Open it to pick new options.', 409);
        }
        throw err;
    }
    if (!quote.orderable) throw new ApiError('CONFLICT', 'This part no longer quotes with the options you ordered. Open it to pick new options.', 409, { quoteId: quote.id });
    return { quoteId: quote.id, checkoutUrl: new URL(`/checkout/${encodeURIComponent(quote.id)}`, env().APP_URL).toString() };
}
