/**
 * Views of supplier-route orders: the buyer's (no supplier identity, one sentence per step) and
 * the ops leg view for the Sourcing desk.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import type { OrderSupplierRouteView, SupplierLegOpsView, SupplierRouteStep } from '../../contracts/promise';
import { getDb, type DbOrTx } from '../db';
import { approvals, orderPaymentPlans, orders, payments, shops, supplierLegs, supplierQuotes, suppliers } from '../db/schema';
import { countryName, routeOfferLabel } from '../sourcing/views';
import { legSentence, opsAllowedNext } from './legs';
import { PAY_URL_KEY, paymentPurpose } from './payments';

type OrderRow = typeof orders.$inferSelect;
type LegRow = typeof supplierLegs.$inferSelect;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

type StepKey = SupplierRouteStep['key'];

/** Pure: steps + sentences from the leg, the order and where things are. */
export function buildSupplierSteps(input: {
    leg: Pick<LegRow, 'status' | 'createdAt' | 'productionStartedAt' | 'shippedInboundAt' | 'receivedAt' | 'deliveredAt' | 'directShip'> | null;
    order: Pick<OrderRow, 'status' | 'shippedAt' | 'deliveredAt'>;
    origin: string;
    partnerCity: string | null;
}): SupplierRouteStep[] {
    const { leg, order, origin, partnerCity } = input;
    const direct = leg?.directShip ?? false;
    const keys: StepKey[] = direct ? ['PO_PLACED', 'IN_PRODUCTION_AT_SUPPLIER', 'SHIPPED_INBOUND', 'DELIVERED'] : ['PO_PLACED', 'IN_PRODUCTION_AT_SUPPLIER', 'SHIPPED_INBOUND', 'RECEIVED_AT_PARTNER', 'SHIPPED_TO_YOU', 'DELIVERED'];
    const where = partnerCity ? `our partner in ${partnerCity}` : 'our US receiving partner';
    const reached: Record<StepKey, Date | null> = {
        PO_PLACED: leg?.createdAt ?? null,
        IN_PRODUCTION_AT_SUPPLIER: leg?.productionStartedAt ?? null,
        SHIPPED_INBOUND: leg?.shippedInboundAt ?? null,
        RECEIVED_AT_PARTNER: leg?.receivedAt ?? null,
        SHIPPED_TO_YOU: order.shippedAt ?? null,
        DELIVERED: order.deliveredAt ?? leg?.deliveredAt ?? null,
    };
    const done: Record<StepKey, string> = {
        PO_PLACED: `Purchase order placed with a verified partner in ${origin}`,
        IN_PRODUCTION_AT_SUPPLIER: `Made by our partner in ${origin}`,
        SHIPPED_INBOUND: direct ? `Shipped to you from ${origin}` : `Shipped to ${where}`,
        RECEIVED_AT_PARTNER: `Received and inspected by ${where}`,
        SHIPPED_TO_YOU: 'Shipped to you',
        DELIVERED: 'Delivered',
    };
    const current: Record<StepKey, string> = {
        PO_PLACED: legSentence(null, { origin, partnerCity, directShip: direct }),
        IN_PRODUCTION_AT_SUPPLIER: `Being made in ${origin}`,
        SHIPPED_INBOUND: direct ? `On its way to you from ${origin}` : `On its way to ${where}`,
        RECEIVED_AT_PARTNER: `Received by ${where} · inspecting`,
        SHIPPED_TO_YOU: 'Passed inspection · ready to ship to you',
        DELIVERED: 'Out for delivery',
    };
    const upcoming: Record<StepKey, string> = {
        PO_PLACED: 'Purchase order',
        IN_PRODUCTION_AT_SUPPLIER: `Made in ${origin}`,
        SHIPPED_INBOUND: direct ? 'Shipped to you' : `Shipped to ${where}`,
        RECEIVED_AT_PARTNER: 'Inspected on arrival',
        SHIPPED_TO_YOU: 'Shipped to you',
        DELIVERED: 'Delivered',
    };
    // While the partner is inspecting, "received" is the current step even though it has a date.
    let currentIdx = keys.findIndex((k) => !reached[k]);
    if (!direct && leg && (leg.status === 'RECEIVED_AT_PARTNER' || leg.status === 'QA_FAILED') && order.status !== 'QA_PASSED' && !order.shippedAt) currentIdx = keys.indexOf('RECEIVED_AT_PARTNER');
    const stopped = order.status === 'REFUNDED' || order.status === 'CANCELLED' || leg?.status === 'CANCELLED';
    return keys.map((key, i) => {
        const at = iso(reached[key]);
        if (currentIdx === -1 || i < currentIdx) return { key, sentence: done[key], state: 'done', at };
        if (i === currentIdx) {
            if (stopped) return { key, sentence: 'Stopped · this order was refunded', state: 'failed', at };
            if (key === 'RECEIVED_AT_PARTNER' && leg?.status === 'QA_FAILED') return { key, sentence: legSentence('QA_FAILED', { origin, partnerCity, directShip: direct }), state: 'failed', at };
            return { key, sentence: current[key], state: 'current', at };
        }
        return { key, sentence: upcoming[key], state: 'upcoming', at: null };
    });
}

/** Buyer view of a supplier-route order (null for shop-route orders). */
export async function orderSupplierRouteView(order: OrderRow, db: DbOrTx = getDb()): Promise<OrderSupplierRouteView | null> {
    const [sq] = await db.select().from(supplierQuotes).where(eq(supplierQuotes.quoteId, order.quoteId));
    if (!sq) return null;
    const [[plan], [leg], [partner], pending] = await Promise.all([
        db.select().from(orderPaymentPlans).where(eq(orderPaymentPlans.orderId, order.id)),
        db.select().from(supplierLegs).where(eq(supplierLegs.orderId, order.id)),
        sq.receivingShopId ? db.select({ city: shops.city }).from(shops).where(eq(shops.id, sq.receivingShopId)) : Promise.resolve([]),
        db
            .select()
            .from(payments)
            .where(and(eq(payments.orderId, order.id), eq(payments.status, 'PENDING')))
            .orderBy(desc(payments.createdAt)),
    ]);
    const supplier = sq.composition.supplierStatus;
    const origin = countryName(supplier.country);
    const balanceSession = pending.find((p) => paymentPurpose(p.metadata) === 'balance');
    const payUrl = balanceSession?.metadata?.[PAY_URL_KEY];
    return {
        label: routeOfferLabel({ verified: supplier.verified, country: supplier.country }),
        legStatus: leg?.status ?? null,
        directShip: leg?.directShip ?? sq.receivingShopId === null,
        steps: buildSupplierSteps({ leg: leg ?? null, order, origin, partnerCity: partner?.city ?? null }),
        payment: {
            kind: plan?.kind ?? 'DEPOSIT_BALANCE',
            depositCents: plan?.depositCents ?? order.totalCents,
            balanceCents: plan?.balanceCents ?? 0,
            creditCents: plan?.creditCents ?? 0,
            depositPaid: Boolean(plan?.depositPaidAt),
            balancePaid: Boolean(plan?.balancePaidAt) || (plan?.balanceCents ?? 0) === 0,
            balancePayUrl: !plan?.balancePaidAt && typeof payUrl === 'string' ? payUrl : null,
        },
    };
}

/** Ops view of one leg. */
export async function legOpsView(legId: string, db: DbOrTx = getDb()): Promise<SupplierLegOpsView> {
    const [row] = await db
        .select({ leg: supplierLegs, order: orders, supplier: suppliers })
        .from(supplierLegs)
        .innerJoin(orders, eq(orders.id, supplierLegs.orderId))
        .innerJoin(suppliers, eq(suppliers.id, supplierLegs.supplierId))
        .where(eq(supplierLegs.id, legId));
    if (!row) throw new Error(`Supplier leg ${legId} not found`);
    return toLegOpsView(db, row.leg, row.order, row.supplier);
}

async function toLegOpsView(db: DbOrTx, leg: LegRow, order: OrderRow, supplier: typeof suppliers.$inferSelect): Promise<SupplierLegOpsView> {
    const [[shop], [deposit]] = await Promise.all([
        leg.receivingShopId ? db.select({ id: shops.id, name: shops.name }).from(shops).where(eq(shops.id, leg.receivingShopId)) : Promise.resolve([]),
        leg.depositApprovalId ? db.select({ id: approvals.id, status: approvals.status }).from(approvals).where(eq(approvals.id, leg.depositApprovalId)) : Promise.resolve([]),
    ]);
    return {
        id: leg.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: leg.status,
        poNumber: leg.poNumber,
        supplier: { id: supplier.id, name: supplier.name, country: supplier.country },
        offerId: leg.offerId,
        incoterm: leg.incoterm,
        directShip: leg.directShip,
        inboundCarrier: leg.inboundCarrier,
        inboundTracking: leg.inboundTracking,
        receivingShop: shop ?? null,
        receivingJobId: leg.receivingJobId,
        supplierDeposit: { approvalId: deposit?.id ?? null, status: deposit?.status ?? 'NOT_REQUESTED', amountCents: leg.supplierDepositCents },
        preShipmentInspection: leg.preShipmentInspection === 'PASS' || leg.preShipmentInspection === 'FAIL' ? leg.preShipmentInspection : null,
        allowedNext: opsAllowedNext(leg.status, { directShip: leg.directShip }),
        history: leg.history.map((h) => ({ status: h.status as SupplierLegOpsView['status'], at: h.at, note: h.note })),
        createdAt: leg.createdAt.toISOString(),
    };
}

/** Every leg created from a sourcing job (Sourcing desk job detail). */
export async function legsForJob(jobId: string, db: DbOrTx = getDb()): Promise<SupplierLegOpsView[]> {
    const rows = await db
        .select({ leg: supplierLegs, order: orders, supplier: suppliers })
        .from(supplierLegs)
        .innerJoin(orders, eq(orders.id, supplierLegs.orderId))
        .innerJoin(suppliers, eq(suppliers.id, supplierLegs.supplierId))
        .where(eq(supplierLegs.jobId, jobId))
        .orderBy(asc(supplierLegs.createdAt));
    return Promise.all(rows.map((r) => toLegOpsView(db, r.leg, r.order, r.supplier)));
}
