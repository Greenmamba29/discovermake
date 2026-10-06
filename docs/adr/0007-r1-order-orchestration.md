# ADR-0007 · R1 order orchestration: Postgres state machine + transactional outbox

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes (for R1 only):** the Temporal `OrderWorkflow` sketch in workflow 04

## Context
Workflow 04 describes the order lifecycle as a Temporal workflow with child workflows for sourcing, dispatch and shipment. R1 ("Cut") only sells catalog laser-cut parts made by partner shops from stock material. There is no sourcing step, no build-slot threshold, and no authorization that expires in 7 days. Every step is driven by an external actor (payment webhook, shop tap, carrier webhook, ops) rather than by a timer.

Running Temporal for R1 would add a cluster, a worker deployment, and a second source of truth for order state without buying anything that R1 needs.

## Decision
1. **The `orders` row is the system of record for "what was purchased and its status"** (spec §18, commerce). Status moves only through `advanceOrder()` (`src/server/orders/advance.ts`), which:
   - locks the row (`SELECT … FOR UPDATE`),
   - checks the pure transition table in `src/server/orders/state.ts` (`assertTransition`),
   - updates status, lifecycle timestamps and a `version` counter,
   - writes `order_status_history`,
   - writes an `order.status_changed` domain event,
   all in **one transaction**, optionally joined to the caller's transaction so the job, payment or shipment change commits atomically with the order transition.
2. **State machine** (R1):
   `PENDING_PAYMENT → PAID → DISPATCHED → ACCEPTED → IN_PRODUCTION → QA_PASSED → SHIPPED → DELIVERED → COMPLETE`, plus `PAYMENT_FAILED` (retryable), `QA_FAILED → IN_PRODUCTION` (rework), `DISPATCHED → PAID` (no shop accepted, re-dispatch), `CANCELLED` (before money moved) and `REFUNDED` (after payment, before shipping). Shipping without a QA pass is impossible by construction (`IN_PRODUCTION → SHIPPED` and `QA_FAILED → SHIPPED` are not in the table).
3. **Transactional outbox** (ADR-0002): every meaningful transition calls `emitEvent(tx, …)` (`src/server/events/outbox.ts`) inside the same transaction. The row lands in `domain_events` with the full ADR-0002 envelope and a `pg_notify('domain_events', event_id)` that fires on commit. `publishPendingEvents()` relays unpublished rows to in-process subscribers using `FOR UPDATE SKIP LOCKED` and marks them published. The buyer timeline reads `domain_events` directly.
4. **Side effects after commit.** Emails, the next dispatch offer and carrier/payment API calls run after the transaction commits. Every handler is idempotent, so a crash between commit and side effect is repaired by a retry or a replay: webhooks are deduplicated in `webhook_events`, ledger postings use unique `txn_key`s, and payouts and passports are unique per order.
5. **Timers.** The only R1 timer is the 2-hour shop offer window. It is enforced lazily (an expired offer cannot be accepted) and swept by `expireStaleOffers()`, called from the admin API or a cron route.

## Consequences
- One database holds all R1 state. Tests run against throwaway Postgres databases (`createTestDb()`), and order state can be rebuilt by replaying events (workflow 12).
- Long waits and fan-out are explicit code paths rather than durable timers. That is acceptable at R1 volume (tens of orders a day).
- **Temporal arrives in R2**, when sourcing (Accio bridge, ADR-0005), build-slot thresholds and multi-leg split routing need durable timers, retries over days and human-approval signals. The migration path is straightforward: `advanceOrder` stays the only writer of `orders.status`; Temporal activities call it instead of route handlers, and the outbox remains the event source.
