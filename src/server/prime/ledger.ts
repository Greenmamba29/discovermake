/**
 * Ledger postings for supplier-route orders (ADR-0004 double entry; txn keys unique per event,
 * so every posting is idempotent):
 *
 *   deposit:<orderId>           DEBIT CASH charged (+ DEBIT BUYER_CREDITS credit)  / CREDIT CUSTOMER_DEPOSITS deposit
 *   balance:<orderId>           DEBIT CASH balance                                 / CREDIT CUSTOMER_DEPOSITS balance
 *   supplier_recognize:<orderId> (once fully paid)
 *                               DEBIT CUSTOMER_DEPOSITS total
 *                               / CREDIT SUPPLIER_PAYABLE landed, SHOP_PAYABLE receiving fee, SHIPPING_PAYABLE shipping,
 *                                 RISK_RESERVE reserve, PLATFORM_REVENUE margin (+ rounding)
 *   supplier_deposit:<orderId>  (ops approved PAY_DEPOSIT) DEBIT SUPPLIER_PAYABLE / CREDIT CASH
 *   refund:<orderId>            before recognition: DEBIT CUSTOMER_DEPOSITS / CREDIT CASH (+ CREDIT BUYER_CREDITS)
 *                               after recognition:  DEBIT REFUNDS / CREDIT CASH (+ CREDIT BUYER_CREDITS)
 */
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { ledgerEntries, orders, supplierQuotes } from '../db/schema';
import { postTransaction } from '../ledger';

type OrderRow = typeof orders.$inferSelect;

export const primeTxnKeys = {
    deposit: (orderId: string) => `deposit:${orderId}`,
    balance: (orderId: string) => `balance:${orderId}`,
    recognize: (orderId: string) => `supplier_recognize:${orderId}`,
    supplierDeposit: (orderId: string) => `supplier_deposit:${orderId}`,
    refund: (orderId: string) => `refund:${orderId}`,
};

export async function postDeposit(tx: DbOrTx, order: OrderRow, input: { depositCents: number; creditCents: number }): Promise<boolean> {
    return postTransaction(
        tx,
        primeTxnKeys.deposit(order.id),
        [
            { account: 'CASH', direction: 'DEBIT', amountCents: input.depositCents - input.creditCents, memo: `Deposit ${order.orderNumber}` },
            { account: 'BUYER_CREDITS', direction: 'DEBIT', amountCents: input.creditCents, memo: 'Promise credit applied to the deposit' },
            { account: 'CUSTOMER_DEPOSITS', direction: 'CREDIT', amountCents: input.depositCents, memo: 'Held until the order is fully paid' },
        ],
        { orderId: order.id, currency: order.currency },
    );
}

export async function postBalance(tx: DbOrTx, order: OrderRow, balanceCents: number): Promise<boolean> {
    if (balanceCents <= 0) return false;
    return postTransaction(
        tx,
        primeTxnKeys.balance(order.id),
        [
            { account: 'CASH', direction: 'DEBIT', amountCents: balanceCents, memo: `Balance ${order.orderNumber}` },
            { account: 'CUSTOMER_DEPOSITS', direction: 'CREDIT', amountCents: balanceCents, memo: 'Balance held until recognized' },
        ],
        { orderId: order.id, currency: order.currency },
    );
}

/** Once deposit + balance are in: split the held money into what is owed and what is earned. */
export async function postRecognition(tx: DbOrTx, order: OrderRow): Promise<boolean> {
    const [sq] = await tx.select().from(supplierQuotes).where(eq(supplierQuotes.quoteId, order.quoteId));
    if (!sq) throw new Error(`Order ${order.id} is not a supplier-route order`);
    const c = sq.composition;
    const landed = c.landed.totalCents;
    const receiving = order.shopCostCents;
    const reserve = c.riskReserveCents;
    const revenue = order.subtotalCents - landed - receiving - reserve;
    if (revenue < 0) throw new Error(`Order ${order.id} subtotal does not cover its composition`);
    return postTransaction(
        tx,
        primeTxnKeys.recognize(order.id),
        [
            { account: 'CUSTOMER_DEPOSITS', direction: 'DEBIT', amountCents: order.totalCents, memo: `Recognize ${order.orderNumber}` },
            { account: 'SUPPLIER_PAYABLE', direction: 'CREDIT', amountCents: landed, memo: `Owed to supplier ${sq.supplierId} (landed cost)` },
            { account: 'SHOP_PAYABLE', direction: 'CREDIT', amountCents: receiving, memo: 'Owed to the receiving partner' },
            { account: 'SHIPPING_PAYABLE', direction: 'CREDIT', amountCents: order.shippingCents, memo: 'Outbound shipping collected' },
            { account: 'RISK_RESERVE', direction: 'CREDIT', amountCents: reserve, memo: `Risk reserve (${c.risk.tier})` },
            { account: 'PLATFORM_REVENUE', direction: 'CREDIT', amountCents: revenue, memo: 'DiscoverMake margin' },
            { account: 'TAX_PAYABLE', direction: 'CREDIT', amountCents: order.taxCents, memo: 'Sales tax collected' },
        ],
        { orderId: order.id, currency: order.currency },
    );
}

export async function postSupplierDeposit(tx: DbOrTx, order: OrderRow, amountCents: number, supplierId: string): Promise<boolean> {
    if (amountCents <= 0) return false;
    return postTransaction(
        tx,
        primeTxnKeys.supplierDeposit(order.id),
        [
            { account: 'SUPPLIER_PAYABLE', direction: 'DEBIT', amountCents, memo: `Deposit paid to supplier ${supplierId} with the PO` },
            { account: 'CASH', direction: 'CREDIT', amountCents, memo: 'Supplier deposit (approved by ops)' },
        ],
        { orderId: order.id, currency: order.currency },
    );
}

export async function isRecognized(tx: DbOrTx, orderId: string): Promise<boolean> {
    const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.txnKey, primeTxnKeys.recognize(orderId)));
    return (row?.n ?? 0) > 0;
}

/** Reverse what the buyer paid (cash refunded, credit restored). */
export async function postSupplierRefund(tx: DbOrTx, order: OrderRow, input: { cashCents: number; creditCents: number }): Promise<boolean> {
    const recognized = await isRecognized(tx, order.id);
    const held = recognized ? 'REFUNDS' : 'CUSTOMER_DEPOSITS';
    return postTransaction(
        tx,
        primeTxnKeys.refund(order.id),
        [
            { account: held, direction: 'DEBIT', amountCents: input.cashCents + input.creditCents, memo: recognized ? 'Refund after recognition (contra-revenue)' : 'Held deposit returned' },
            { account: 'CASH', direction: 'CREDIT', amountCents: input.cashCents, memo: `Refund ${order.orderNumber}` },
            { account: 'BUYER_CREDITS', direction: 'CREDIT', amountCents: input.creditCents, memo: 'Promise credit restored' },
        ],
        { orderId: order.id, currency: order.currency },
    );
}
