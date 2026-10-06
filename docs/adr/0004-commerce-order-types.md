# ADR-0004 · Commerce model and explicit order types

- **Status:** Accepted (draft for G2 review)
- **Date:** 2026-10-06

## Decision
- An explicit `order_type` enum: `STOCKED_PRODUCT · MADE_TO_ORDER · CUSTOM_BUILD · REMIX_BUILD · PROTOTYPE · SMALL_BATCH · PRODUCTION_RUN · BUILD_SLOT · LIVE_DROP`.
- Stripe handles payments (card, ACH, wire, Apple and Google Pay), Connect payouts and Tax. Medusa modules are used for cart, pricing and promotions where they save effort; verify their current licensing first. DiscoverMake owns build-slot logic, quote normalization and the royalty ledger.
- **Pricing is server-side only.** The client sends a `quote_id`. Every order line snapshots the `design_version`, the quote and its trust level. Only **binding** or approved **supplier-confirmed** quotes are orderable (workflow 03).
- `BUILD_SLOT` and `LIVE_DROP` authorize at claim and capture when the threshold is met. Windows longer than 7 days use SetupIntent and charge on confirmation. Missed thresholds auto-release.
- A double-entry `ledger_entries` table records every split: shop, creator royalty, presenter commission, affiliate, platform.

## Consequences
Reporting and payouts are auditable, and new commerce modes (auctions, subscriptions) slot in as order types and ledger rules.
