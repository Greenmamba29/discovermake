# 13 · Epics + backlog

These are the GitHub epics from spec §26, mapped to releases and sequenced. Each epic should become a GitHub issue with these sections:
- objective
- dependencies
- acceptance criteria
- routes
- data objects
- contracts
- events
- UI components
- test plan
- demo script

The stories below are the first cut. They get estimated at G2.

**R1 status (2026-10-06):** R1 "Cut" runs a real order end to end (upload → DFM → binding quote → checkout → payment → dispatch → Shop Console → QA → shipment → delivery → passport → payouts). The checkboxes below reflect what is in the repo; notes in *italics* record where R1 scope differed from the story.

## Sequencing

```
EPIC-001 Shared Platform ─┬─▶ EPIC-900 Commerce + Ordering ─▶ EPIC-500 My Builds ─▶ EPIC-1000 Passport     (R1)
                          ├─▶ EPIC-600 Build Graph ─▶ EPIC-100 MAKE ─▶ EPIC-300 Build Workspace             (R2)
                          ├─▶ EPIC-700 MAKE Compiler (quote engine → sourcing → routing)                  (R1→R3)
                          └─▶ EPIC-800 Live Infrastructure ─▶ EPIC-200 LIVE ◀─ EPIC-400 Creator Studio      (R4)
```

## EPIC-001 · Shared Platform (R1)
- [ ] 001-1 Security remediation (workflow 11, actions 1–7) · *R1: code actions 3, 4, 5, 7 are done here (make-sync and download routes deleted with the old product; signed expiring URLs; server-only pricing; Stripe webhook writes Postgres). Still open: owner credential rotation (1, 2) and the 2.0 repo admin guard (6).*
- [ ] 001-2 Monorepo conversion; move the app to `apps/web` with no behavior change
- [x] 001-3 Postgres plus migrations tooling; `identities` mapping from Firebase UIDs · *R1: Postgres 16 + Drizzle migrations (`database/migrations`), throwaway DB per test suite. Firebase was removed with the old product, so no UID mapping is needed.*
- [ ] 001-4 Auth with roles (buyer, creator, shop, ops, admin) and server-side guards · *R1 (ADR-0008): signed guest order links, hashed shop console tokens + httpOnly sessions, ADMIN_TOKEN / CRON_SECRET bearer. Real user accounts and roles are R2.*
- [x] 001-5 `packages/contracts` (zod) and the domain event envelope with outbox · *R1: `src/contracts/**` (moves to a package with the monorepo), ADR-0002 envelope, transactional outbox + cron publisher.*
- [ ] 001-6 `packages/design-system` tokens and core components (DMButton, StatusPill, MakeabilityScore, ProductCard, Timeline…) · *R1 partial: tokens in Tailwind + `src/components/ui` (Button, StatusPill, MakeabilityRing, Timeline, QtyStepper, ConfirmAction).*
- [ ] 001-7 App shell with the new IA (Discover · Make · Live · Builds · Me)
- [ ] 001-8 Signed file uploads, AV scan, storage · *R1: signed PUT/GET (local + S3/R2), type sniffing, 25 MB cap. AV scan and the sandboxed parser are still open.*
- [ ] 001-9 Observability (OTel, Sentry, PostHog) and feature flags
- [ ] 001-10 Onboarding v2 (4-step, deferred signup); repurposes `/onboarding`

## EPIC-700 · MAKE Compiler: quote engine (R1), Accio sourcing (R2), Promise and routing (R3)
- [x] 700-1 Catalog schema (materials, thickness, processes, services, shop capabilities) and seed data · *plus `shop_services` (finish / secondary-op capability).*
- [ ] 700-2 Python geometry worker: DXF parse, clean, feature extraction, GLB/SVG preview · *R1: done in TypeScript in-process (dxf-parser; parse, clean, features, SVG + 3D preview). Isolated worker with CPU/time limits is still open.*
- [ ] 700-3 STEP sheet-metal detection and unfolding (license review first)
- [x] 700-4 DFM rule engine (versioned rules as data) and Makeability score
- [x] 700-5 Pricing model, quantity ladder, per-shop coefficients · *coefficients are uncalibrated defaults until 700-6.*
- [ ] 700-6 Golden-part suite (50 parts plus invoices) wired into CI · *R1: 18 generated DXF fixtures with known answers run in vitest; the invoice-calibrated 50-part suite is still open.*
- [x] 700-7 Lead-time calculator fed by shop capacity · *queue days + machine hours, shop business days.*
- [ ] 700-8 `SourcingProvider` interface plus shop-stock and catalog providers (R3)
- [ ] 700-9 `services/accio-bridge` MCP server: 9 `discovermake.sourcing.*` tools, auth, leases, audit log (R2)
- [ ] 700-9a `SourcingRequest` / `SupplierOffer` contracts and stale-version rejection (R2)
- [ ] 700-9b Accio Work agent group configured and versioned in `mcp/discovermake-sourcing/` (R2)
- [ ] 700-9c OPA approval boundary and `request_approval` UI for ops and customers (R2)
- [ ] 700-9d Quote trust levels across Quote, Route and Checkout (R2)
- [ ] 700-9e Sourcing desk admin UI (fallback) (R2)
- [ ] 700-10 Delivery Promise engine plus credit policy (R3)
- [ ] 700-11 OR-Tools dispatch and batching (R3)

## EPIC-900 · Commerce + On-Demand Ordering (R1)
- [x] 900-1 Order type enum and order and quote snapshot schema
- [x] 900-2 Configure screen (DoorDash option groups, sticky CTA)
- [x] 900-3 Instant Quote screen (tiers, breakdown with ⓘ) · *shares one screen with Configure at `/parts/[partId]`.*
- [x] 900-4 Manufacturing Route screen (supplier cards, Recommended)
- [x] 900-5 Approve + Checkout (Stripe Payment Element, ACH, wire, server-side pricing) · *R1: hosted Stripe Checkout (card, ACH, wallets) instead of the embedded Payment Element; wire transfer deferred.*
- [ ] 900-6 Temporal OrderWorkflow with every failure path · *R1 uses the ADR-0007 state machine + outbox + cron sweeps instead.*
- [x] 900-7 Ledger plus Stripe Connect payouts (shop and creator) · *R1: double-entry ledger, shop payouts (Connect transfer or manual settle via admin API). Creator payouts are R4.*
- [x] 900-8 Carrier integration (rates, labels, tracking webhooks) · *EasyPost labels + signed tracking webhooks; quote-time rates use a static calibrate-me table.*

## EPIC-500 · My Builds / Orders (R1)
- [ ] 500-1 Builds list (All/Created/Remixed/Ordered/Following) with universal status pills
- [x] 500-2 Production Run screen (slot confirmed, capacity bar, activity)
- [x] 500-3 Order Tracking (Uber-style stepper, map, shop card, messaging) · *R1: stepper, live timeline, shop card, tracking; map and messaging are R2.*
- [ ] 500-4 Reorder / Remix / Repair actions

## EPIC-1000 · Product Passport (R1 v0 → R2 full)
- [x] 1000-1 Passport generation on `product.delivered`
- [x] 1000-2 Signed snapshot hash plus public verify page with QR
- [ ] 1000-3 Replacement-part quote from the passport

## Shop network (part of EPIC-700/900, R1)
- [x] S-1 Shop onboarding and verification flow · *R1: `POST /api/admin/shops` (rate card, capabilities, services, one-time console token); verification is a manual ops step.*
- [ ] S-2 Shop Console: inbox, job packet, milestones, QA upload, capacity calendar · *R1: inbox, signed packet, milestones, QA with photos, shipping are done; the capacity calendar is still open.*
- [x] S-3 Adapter L0 (email plus portal) and L1 (console)

## EPIC-600 · Build Graph (R2)
- [ ] 600-1 Node and edge tables, common metadata, versioning (`DesignVersion`)
- [ ] 600-2 `packages/build-graph` API: create, fork (remix), clone (Make This), diff
- [ ] 600-3 Graph View (reactflow, reusing `visualizer.tsx`) and Object View (r3f)

## EPIC-100 · MAKE (R2)
- [ ] 100-1 Make prompt and attachment tray (text, image, CAD, voice)
- [ ] 100-2 Requirements Agent with structured output and the NEEDS_INPUT question cards
- [ ] 100-3 Materials Engineer (structured recommendation)
- [ ] 100-4 CAD worker (CadQuery from structured spec) and evals
- [ ] 100-5 Acceptance test: enclosure prompt produces 11 artifacts

## EPIC-300 · Build Workspace (R2)
- [ ] 300-1 BuildShell and the 11-section nav
- [ ] 300-2 ObjectViewport with annotations and measurements
- [ ] 300-3 Make AI panel (suggestions, warnings, approvals)
- [ ] 300-4 Status strip (Makeability, cost, lead time, confidence, version)

## EPIC-400 · Creator Studio (R4)
- [ ] 400-1 Build publisher (states, remix license, royalty %)
- [ ] 400-2 Product manager and channel page
- [ ] 400-3 Show planner
- [ ] 400-4 Live control room (feature product, start drop, Ask Make AI, bring viewer on, clip)
- [ ] 400-5 Revenue and royalty dashboards

## EPIC-800 · Live Infrastructure (R4)
- [ ] 800-1 LiveKit project and token service (scoped grants)
- [ ] 800-2 MediaMTX ingest cluster (RTMP/SRT/RTSP/WHIP → LiveKit), per-source keys
- [ ] 800-3 `live-gateway`: protocol validation, signing, persistence, snapshots for late joiners
- [ ] 800-4 Egress recording and the event track for replays
- [ ] 800-5 Make AI as a LiveKit Agents participant with guardrails
- [ ] 800-6 Owncast bridge (optional)

## EPIC-200 · LIVE (R4 → R5)
- [ ] 200-1 Live viewer (vertical, product card overlay, right rail)
- [ ] 200-2 Ask Creator / Ask Make AI
- [ ] 200-3 Make This and Remix overlays without leaving the stream
- [ ] 200-4 Build Slots and Live Drops (authorize, capture on threshold, auto-release)
- [ ] 200-5 For You feed (heuristic ranker with logging)
- [ ] 200-6 Watch My Build (scoped production rooms)
- [ ] 200-7 Replays (R5), clip engine (R5), auctions (R5), factory channels (R5)

## First sprint (after G2)

001-1 security remediation · 001-2 monorepo move · 001-3 Postgres · 001-5 contracts and events · 700-1 catalog · 700-2 DXF worker spike · 900-2 Configure screen hi-fi build
