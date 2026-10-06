# 04 · On-demand ordering framework

Six connected screens. Spec §12 calls them a required V1 layer:

```
CONFIGURE → QUOTE → ROUTE → APPROVE → BUILD → TRACK
```

They should feel like **DoorDash**: one product, clear required choices, a running total, a sticky CTA, a transparent fee breakdown, then a live status bar. Mobbin references are in workflow 10.

## Screen-by-screen

### 01 Configure (`/build/:buildId/configure`)
- Object-first: 3D or photo carousel at the top.
- **Option groups** work like DoorDash item customization. Each group is labeled `Required · Select 1` or `Optional · Up to N`:
  - Variant
  - Material (swatch chips)
  - Finish
  - Dimensions (bounded steppers, validated against DFM)
  - Quantity
  - Personalization (logo/engrave upload)
  - Notes
- Sticky CTA reads **"Make 1 required selection"** until the configuration is valid. Then it switches to **"Save & Get Quote · $189"**.
- Save Draft is always available. Drafts appear in My Builds.

### 02 Instant Quote (`/build/:buildId/quote`)
- Three tiers: **Prototype** (1–9) · **Small Batch** (10–250, the "Most popular" default) · **Production Run** (250+).
- A unit / total toggle.
- Cost breakdown: materials · machining/cutting · finishing and assembly · QA · packaging · tooling. Each line has an ⓘ explainer, the way DoorDash shows fees.
- Lead time per tier, from workflow 03.
- CTA: **Continue to Manufacturing Route**.

### 03 Manufacturing Route (`/build/:buildId/route`)
- Tabs: **Suppliers · Processes · Impact**.
- Each supplier card shows:
  - photo
  - name
  - location
  - rating and review count
  - capability chips
  - lead time
  - unit cost
  - MOQ
  - certifications
  - CO₂ per unit
- DiscoverMake pre-selects a **Recommended** route with the best score from workflow 03. Most customers never change it, but they can.
- **Help me choose:** Make AI explains the tradeoffs in plain language.

### 04 Approve + Checkout (`/build/:buildId/approve`)
- Locked summary: design version, material, finish, dimensions, quantity, unit price, subtotal.
- Shipping address, then shipping method (Standard / Expedited / Express, each with a Promise date).
- Payment: Card · ACH · Wire, plus Apple Pay and Google Pay through Stripe. PayPal only if it is already supported.
- Checkbox: Terms · Production Policy · Quality Guarantee.
- CTA: **Pay $18,900 and Start Production**.
- On success, all of these happen in one transaction (outbox pattern): `Order` + `Payment` + an approved `DesignVersion` + a `production.authorized` event.

### 05 Production Run (`/orders/:orderId/production`)
- "Build Slot Confirmed" hero.
- Production overview: quantity, build slot date, estimated start and completion, status pill.
- Capacity bar for aggregate runs, e.g. `193 / 250 slots claimed · production starts at 200`.
- Recent activity feed from domain events, plus **View Production Milestones**.
- **Share project.** Sharing helps reach the MOQ faster and lowers the unit cost.

### 06 Order Tracking (`/orders/:orderId`)
- Uber-style stepper: Design → Materials → Production → QA → Shipping → Delivered.
- Map with the carrier route once it ships.
- Live updates timeline, a "Currently in production" card (with a **Watch** button if the shop streams), and a Product Passport preview.

## Order types (explicit enum, spec §13, ADR-0004)

`STOCKED_PRODUCT · MADE_TO_ORDER · CUSTOM_BUILD · REMIX_BUILD · PROTOTYPE · SMALL_BATCH · PRODUCTION_RUN · BUILD_SLOT · LIVE_DROP`

## Order workflow (Temporal, `workflows/order/`)

```
OrderWorkflow(orderId)
  authorize payment (Stripe PaymentIntent, manual capture for BUILD_SLOT/LIVE_DROP until threshold)
  → lock DesignVersion + Quote (immutable snapshot)
  → SourcingWorkflow (child) → materials.received
  → DispatchWorkflow (child, workflow 05) → shop accepted
  → await production milestones (signals from shop adapter)
  → QA gate (InspectionResult must pass; else rework or refund path)
  → ShipmentWorkflow (child) → delivered
  → capture/settle payment, trigger payouts (creator royalty, shop payout)
  → ProductPassport.activate
```

Failure paths are designed up front and covered by tests:
- payment failure
- supplier timeout
- shop rejects the job
- QA fail
- carrier exception
- customer cancel window
- MOQ not reached (auto-refund of every slot)

## Payments

- Stripe for card, ACH and wire, with Payment Element and Checkout. The current repo already has Stripe Checkout, a signature-verified webhook and Connect payouts. Reuse all three.
- **Server-side price only.** The client sends `quoteId` and the server prices it. discovermake-2.0 currently trusts a client-supplied amount; do not port that.
- Build slots and drops authorize at claim and capture when the run is confirmed. Authorizations expire after 7 days, so long drops use SetupIntent and charge on confirmation.

## Acceptance

Spec §30 steps 3, 4, 7, 8 and 9 run end to end on staging with Stripe test mode and the sandbox shop adapter. No mocked state.
