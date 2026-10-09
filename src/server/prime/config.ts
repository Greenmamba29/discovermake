/**
 * R3 Prime policy (owner inputs). Every number has a documented default and an env override
 * (see .env.local.example and docs/architecture/r3-prime.md). Read at call time.
 */
import { env } from '../env';

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export type PrimePolicy = {
    /** Share of a supplier-route order total charged at checkout. */
    depositPct: number;
    /** DiscoverMake margin on the supplier landed cost. */
    marginPct: number;
    /** Risk reserve % per tier. */
    riskReservePct: Record<RiskTier, number>;
    /** Supplier deposit paid with the PO, share of the landed cost. */
    supplierDepositPct: number;
    /** Missed-promise credit: share of the order subtotal, capped. */
    creditPct: number;
    creditCapCents: number;
    /** Supplier-route quotes stay binding at most this long (and never past the offer's own validity). */
    supplierQuoteValidityDays: number;
};

export const DEFAULT_PRIME_POLICY: PrimePolicy = {
    depositPct: 0.5,
    marginPct: 0.18,
    riskReservePct: { LOW: 0.03, MEDIUM: 0.06, HIGH: 0.1, VERY_HIGH: 0.15 },
    supplierDepositPct: 0.3,
    creditPct: 0.1,
    creditCapCents: 25_000,
    supplierQuoteValidityDays: 7,
};

function fraction(raw: string | undefined, fallback: number, name: string): number {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${name} must be a number between 0 and 1 (got "${raw}")`);
    return n;
}

function cents(raw: string | undefined, fallback: number, name: string): number {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer number of cents (got "${raw}")`);
    return n;
}

/** The policy in force (env overrides on top of the defaults). Throws on a malformed override. */
export function primePolicy(): PrimePolicy {
    const e = env();
    let reserve = DEFAULT_PRIME_POLICY.riskReservePct;
    if (e.SUPPLIER_RISK_RESERVE_PCTS) {
        const parts = e.SUPPLIER_RISK_RESERVE_PCTS.split(',').map((p) => fraction(p.trim(), NaN, 'SUPPLIER_RISK_RESERVE_PCTS'));
        if (parts.length !== 4) throw new Error('SUPPLIER_RISK_RESERVE_PCTS needs four comma-separated fractions: LOW,MEDIUM,HIGH,VERY_HIGH');
        reserve = { LOW: parts[0], MEDIUM: parts[1], HIGH: parts[2], VERY_HIGH: parts[3] };
    }
    return {
        depositPct: fraction(e.SUPPLIER_DEPOSIT_PCT, DEFAULT_PRIME_POLICY.depositPct, 'SUPPLIER_DEPOSIT_PCT'),
        marginPct: fraction(e.SUPPLIER_MARGIN_PCT, DEFAULT_PRIME_POLICY.marginPct, 'SUPPLIER_MARGIN_PCT'),
        riskReservePct: reserve,
        supplierDepositPct: fraction(e.SUPPLIER_PO_DEPOSIT_PCT, DEFAULT_PRIME_POLICY.supplierDepositPct, 'SUPPLIER_PO_DEPOSIT_PCT'),
        creditPct: fraction(e.PROMISE_CREDIT_PCT, DEFAULT_PRIME_POLICY.creditPct, 'PROMISE_CREDIT_PCT'),
        creditCapCents: cents(e.PROMISE_CREDIT_CAP_CENTS, DEFAULT_PRIME_POLICY.creditCapCents, 'PROMISE_CREDIT_CAP_CENTS'),
        supplierQuoteValidityDays: DEFAULT_PRIME_POLICY.supplierQuoteValidityDays,
    };
}
