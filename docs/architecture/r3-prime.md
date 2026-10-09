# R3 Prime core: supplier-route ordering and the Delivery Promise

Status: implemented (Stage 2). Code: `src/server/prime/**`, `src/server/promise/**`,
`src/server/routing/**`, `src/server/dispatch/batching.ts`, `src/server/sourcing/providers/**`,
contracts in `src/contracts/promise.ts`, schema in the `// R3 Prime ordering + promise` section at
the end of `src/server/db/schema.ts` (local migration `0006_r3_prime_core.sql`; the integrator
regenerates it).

R3 makes two promises to the buyer, both of which the platform has to keep with money:

1. **One price.** A supplier-confirmed offer becomes a binding DiscoverMake quote. The buyer
   never sees who the supplier is, only "Verified partner · Vietnam".
2. **One date.** "Arrives Thu, Oct 23" is shown only when the engine's P90 arrival fits it.
   If we miss it, the buyer is credited automatically.

## 1. Supplier-route ordering

```
SUPPLIER_CONFIRMED offer ─(buyer selects; ops approves SELECT_OFFER)─▶ "Get your binding price"
  POST /api/builds/:buildId/sourcing/offers/:offerId/quote ─▶ BINDING quote (route: supplier)
  checkout: deposit (50%) charged ─▶ order.deposit_paid ─▶ PO approvals requested
  ops approves PLACE_PURCHASE_ORDER (+ PAY_DEPOSIT) ─▶ supplier leg created (PO number)
  PO_PLACED ─▶ IN_PRODUCTION_AT_SUPPLIER ─▶ SHIPPED_INBOUND ─▶ RECEIVED_AT_PARTNER ─▶ DELIVERED
                                                 │ (Shop Console "Receiving" job, QA at receipt)
                                                 ├─ pass ─▶ balance due ─▶ partner ships (existing ship flow)
                                                 └─ fail ─▶ rework at partner, or refund
  direct ship (no receiving partner): SHIPPED_INBOUND carries a pre-shipment inspection ─▶ DELIVERED
```

### Binding quote and its composition

`src/server/prime/pricing.ts` (pure) prices the offer:

```
landed     = unit × qty + tooling + freight + duties        (duties estimated by incoterm/country)
receiving  = partner receiving fee + per-unit handling        (0 for direct ship)
margin     = ceil(marginPct × landed)
reserve    = ceil(reservePct(risk tier) × landed)
unit price = ceil((landed + receiving + margin + reserve) / qty); subtotal = unit × qty
```

Rounding is always up, so the subtotal is never below cost. The full composition (offer
snapshot, supplier status, risk factors, every component in cents, policy used) is stored on
`supplier_quotes.composition`, and `quote.binding` / `quote.supplier_confirmed` events record it.
Buyer line items are generic (`PARTNER_PRODUCTION`, `TOOLING`, `FREIGHT_DUTIES`, `RECEIVING_QA`,
`DELIVERY_GUARANTEE`) and never name the supplier.

**Risk score** (`assessRisk`, 0–1, additive): unverified supplier +0.35; lead time over 21/30/45
days +0.05/+0.15/+0.25; incoterm puts freight/customs on us (EXW/FCA/FOB +0.2, CFR/CIF/CPT/CIP
+0.1, any other non-DDP +0.05); first order with this supplier +0.15; offer confidence under 0.80 +0.1. Tiers: LOW <0.25,
MEDIUM <0.5, HIGH <0.75, else VERY_HIGH. The reserve % per tier is an owner input (below).

### Money flow: deposit and balance

The payment provider abstraction (`src/server/payments`) is unchanged except for an optional
idempotency key. A supplier-route order has an `order_payment_plans` row:

| Moment | Charge | Ledger (`src/server/prime/ledger.ts`) |
|---|---|---|
| Checkout | deposit = `depositPct` × total (min $0.50), less any promise credit | `deposit:<order>` DR CASH (+ DR BUYER_CREDITS) / CR CUSTOMER_DEPOSITS |
| Ops approves PAY_DEPOSIT | supplier deposit = `supplierDepositPct` × landed (paid by ops, outside the app) | `supplier_deposit:<order>` DR SUPPLIER_PAYABLE / CR CASH |
| QA passes at receipt (or direct ship) | balance: a second hosted payment session; the buyer pays from order tracking (`POST /api/orders/:id/balance`) | `balance:<order>` DR CASH / CR CUSTOMER_DEPOSITS |
| Fully paid | — | `supplier_recognize:<order>` DR CUSTOMER_DEPOSITS / CR SUPPLIER_PAYABLE, SHOP_PAYABLE, SHIPPING_PAYABLE, RISK_RESERVE, PLATFORM_REVENUE |
| Refund | provider refund of what was paid | `refund:<order>` reverses deposits (or REFUNDS after recognition), restores credit |

The partner cannot print a label until the balance is paid (`assertShippable`). Webhook amount
checks are purpose-aware (`deposit` / `balance` / `full`), and supplier orders skip the shop
dispatcher: there is nothing to dispatch until freight arrives.

### Approval boundary

Nothing is ordered from or paid to a supplier without a human approval in the Sourcing desk:

- `SELECT_OFFER` (R2, unchanged) before a binding price exists;
- `PLACE_PURCHASE_ORDER` and `PAY_DEPOSIT`, requested by the `order.deposit_paid` outbox handler
  in its own transaction (lock order: `sourcing_jobs` row first, the same order refunds use);
- leg moves on the supplier side (`POST /api/admin/supplier-legs/:legId/advance`) are admin-only
  and may only set supplier-side statuses; receipt and QA happen in the Shop Console.

The R1 order transition table is unchanged. Leg states map onto it: PO placed → `DISPATCHED`,
supplier production → `ACCEPTED`, freight received → `IN_PRODUCTION`, QA at receipt →
`QA_PASSED` / `QA_FAILED`, then `SHIPPED` and `DELIVERED` through the existing flows.
`advanceOrder` stays the only writer of `orders.status`.

### Where it shows

- Buyer order tracking: one sentence per step (`buildSupplierSteps`, e.g. "On its way to our
  partner in Philadelphia"), the balance as one action, no supplier identity.
- Sourcing desk job detail: legs with PO number, supplier, incoterm, inbound tracking, supplier
  deposit approval and the allowed next statuses as buttons.
- Shop Console: a "Receiving" job (badge in the inbox) with PO, origin and inbound tracking;
  "Freight received" then QA at receipt.

## 2. Delivery Promise engine (`src/server/promise/**`)

```
promise = max(material_arrival_P90 across BOM) + shop_queue_P90 + process_time + QA + pack
        + carrier_transit_P90(zone, service) + buffer(risk_score)
```

- **Priors** are the existing lead-time logic (`src/server/quote/leadtime.ts`, `QA_PACK_DAYS`,
  carrier days); material arrival is 0 when the partner has the sheet in `shop_stock`, the restock
  time (3 days) when it tracks the stock but is short, and the supplier's production + freight on
  the supplier route.
- **Per-leg P90** = prior + learned slip. The model for each (leg, scope) is the empirical 90th
  percentile (nearest rank) of `actual − predicted` over `promise_observations`, floored at 0 so
  we never promise faster than the prior. Scopes go from specific to coarse (process: shop+process
  → shop → process → all; queue/QA/pack: shop → all; transit: carrier service+zone → service → all;
  material: supplier → incoterm → all, or the shop's stock); the most specific scope with ≥ 5
  observations wins.
- **Zones**: Z1 same state, Z2 same US census region, Z3 otherwise (partner → buyer).
- **Buffer**: 0 / 1 / 2 business days for risk score < 0.34 / < 0.67 / higher.
- **Display rule**: the committed date is shown as "Arrives Thu, Oct 23" only when P90 (buffer
  included) ≤ that date; otherwise checkout falls back to "Ships by …". Never a range.

Lifecycle and events:

| When | What |
|---|---|
| Checkout | `promise.set`: per-leg predictions stored on `order_promises` in the checkout transaction |
| Each milestone / leg move | `recheckOrderPromise`: remaining legs' P90 crossing the promised date marks it `AT_RISK` once (`promise.at_risk` + ops alert) |
| Delivered | observations written per leg (predicted vs actual); `promise.kept`, or `promise.missed` + credit |

**Credits** (`credits.ts`): a missed promise that was shown issues `creditPct` × subtotal, capped
(default 10%, $250), as a `buyer_credits` row and ledger `promise_credit:<order>` DR
PROMISE_CREDIT_EXPENSE / CR BUYER_CREDITS. The memo names the responsible leg (the one that
overran its P90 the most) and the shop when it is a shop leg, so the cost can be charged back.
The credit is reserved at the next checkout with the same buyer email, reduces that first charge, becomes
REDEEMED on payment, and is released if that order is never paid.

### Retraining

`GET|POST /api/admin/promise/retrain` (Bearer `ADMIN_TOKEN` or `CRON_SECRET`; Vercel Cron calls
GET weekly, `30 6 * * 1` in `vercel.json`) rebuilds `promise_models` from all observations,
reports the holdout hit rate, and rechecks active promises.

**Holdout** (`evaluateHoldout`): orders whose id hashes (FNV-1a) to 0 mod 5 are held out; models
train on the rest. On synthetic data (`syntheticObservations`, seeded, with skewed per-shop,
per-carrier and per-supplier slips) the order-level hit rate is 98.5–99.5% and leg-level 94–96.5%
across seeds 2026, 7, 99 and 12345; the test asserts ≥ 95% at order level and ≥ 90% per leg.

**Honest note on real data.** These numbers say the method is calibrated when the world looks
like the generator. They do not say anything about real shops, carriers or suppliers. Until real
deliveries exist, every leg uses its prior (no scope has 5 observations), so promises are exactly
as good as the R1 lead-time logic plus the risk buffer. Expect to need roughly 50–100 delivered
orders per shop/process and per carrier service/zone before the scoped models beat the priors,
and a few dozen per supplier/incoterm on the supplier route. Watch the weekly holdout report and
the `promise.missed` rate; if a leg's hit rate stays under 90%, widen the buffer for it.

## 3. Route comparison and dispatch batching

`GET /api/builds/:buildId/routes?quote=` (`src/server/routing`) compares every way to make the
quote: each capable partner shop and each selected supplier offer, with total cost, P90 date,
quality (rating / verified / QA history) and CO₂ (material + freight by mode, `estimateCo2Kg`).
`scoreRoutes` normalises each criterion and weights them cost 0.45, date 0.30, quality 0.15,
CO₂ 0.10; ties break on total, then date, then id, so "Recommended" is deterministic. The
Manufacturing Route page shows it under **Suppliers · Processes · Impact** tabs.

Dispatch batching (`src/server/dispatch/batching.ts`) groups open jobs at a shop with the same
material, thickness and process and overlapping ship windows: first-fit decreasing by sheet area
into one-sheet bins. Batch ids are stable hashes and show on Shop Console jobs. OR-Tools is not
available in this TypeScript stack; `planBatches` sits behind the `BatchPlanner` interface so a
CP-SAT service (bin packing with time windows) can replace it without touching callers.

## 4. Sourcing providers (`src/server/sourcing/providers/**`)

One `SourcingProvider` interface, three implementations:

- **Shop stock** (`shop_stock` table, Shop Console → Stock page): partner sheet and hardware on
  the shelf. Quotes whose sheet is in stock get material arrival 0, i.e. the fastest promise, and
  the route comparison shows "Material in stock".
- **Catalog distributor**: `MouserDistributor` (Search API v1 keyword search). It is enabled only
  when `MOUSER_API_KEY` is set; unconfigured, it reports itself disabled and is never called.
  `FixtureDistributor` backs the tests.
- **Accio Work** stays the long-tail async provider (queued job, offers arrive over MCP).

`findInstantOffers` asks the instant providers in order. It is not yet called from quoting: today's
quotes are single sheet-metal parts whose material comes from shop stock; distributor hardware
lines arrive with BOM quoting.

## 5. Owner inputs

| Input | Default | Where |
|---|---|---|
| Deposit % at checkout | 50% | `SUPPLIER_DEPOSIT_PCT` |
| Margin on landed cost | 18% | `SUPPLIER_MARGIN_PCT` |
| Risk reserve % by tier (LOW, MEDIUM, HIGH, VERY_HIGH) | 3, 6, 10, 15 | `SUPPLIER_RISK_RESERVE_PCTS` |
| Supplier deposit with the PO | 30% of landed | `SUPPLIER_PO_DEPOSIT_PCT` |
| Missed-promise credit | 10% of subtotal, cap $250 | `PROMISE_CREDIT_PCT`, `PROMISE_CREDIT_CAP_CENTS` |
| Distributor keys | none (disabled) | `MOUSER_API_KEY` |
| Carrier accounts | none: transit priors are the R1 carrier days; real carrier rates and tracking need accounts (EasyPost/Shippo or direct UPS/FedEx) | — |
| Partner receiving shops | the dev seed marks Philadelphia Precision as a receiving site; production needs signed partners, fees and per-unit handling in `receiving_sites` | `receiving_sites` |

## 6. Deferred: OPA sidecar and Temporal

- **OPA (policy sidecar)**: approvals stay a typed TypeScript policy table (`src/server/sourcing/approvals.ts`
  plus `prime/purchase-orders.ts`). There are a handful of rules, they change with code reviews,
  and they run inside the same database transaction as the state change they guard. A sidecar
  adds a network hop and a second deploy unit, and moves policy outside the transaction, for no
  gain at this size. Revisit when non-engineers need to edit policy or rules number in the dozens.
- **Temporal (workflow engine)**: the supplier route is a set of Postgres state machines (order,
  leg, payment plan, promise) driven by the transactional outbox. Every step is a row update plus
  an event in one transaction, with idempotent ledger keys, so retries are safe without a
  workflow engine. The long waits (weeks of production and freight) are human or carrier events,
  not timers. Revisit when we need durable timers at scale (e.g. automatic supplier chasing) or
  multi-step compensations across external systems.

## 7. Limitations

- The balance is a second hosted payment session the buyer completes; off-session auto-charge
  needs saved payment methods (not in R1).
- Supplier payments beyond the approved PO deposit (balance to the supplier, duties, freight
  invoices) are accounts payable done by ops; the ledger records the payable, not the payout.
- A binding supplier quote needs a part file and a prior quote on that part (graph-only builds get
  `CONFLICT`).
- Direct ship (no receiving partner) is supported by the state machine and ops tooling; it skips the
  partner's passport and payout.
- Duties are estimates by incoterm and origin, not a customs classification.
