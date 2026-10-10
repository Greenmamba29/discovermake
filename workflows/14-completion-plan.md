# 14 · Completion plan: the stages to finish the whole app

**As of 2026-10-08.**
- R1 "Cut" is merged (PR #1). A real order runs end to end.
- R2 increment 1 "Make + Source" is in review (PR #2). It adds the Build Workspace, the CAD worker, the Accio sourcing bridge and the sourcing desk.

> **Status, 2026-10-09: every stage below is built and integrated on PR #2.** Stages 1–5 and the GA hardening track are in place, apart from the items deliberately deferred. All gates are green: tsc, lint, vitest, pytest, the Playwright journeys on desktop plus Pixel 7 and iPhone 14 profiles, the page sweep, load and restore drills. See `docs/architecture/launch-readiness.md` for the evidence and the owner inputs needed to go live.

This plan covers everything left between today and the full product in workflows 00–13: Discover, Make, Live, My Builds, Creator Studio, Media and Reconstruct. It follows the SDLC in workflow 00. Every stage ends at a **G3 gate**: its demo script runs on staging with real data, the full test suite is green, and the **Mobbin page sweep** is green.

## 1. Where the screens stand (page sweep, 2026-10-08)

`tests/e2e/page-sweep.spec.ts` opens every screen with real data at **390 px (phone)** and **1280 px (desktop)**. On each screen it checks:
- exactly one h1 and a main landmark;
- no console errors, page errors or unexpected failed requests;
- no horizontal scroll, including with every ⓘ explainer open on phones;
- axe WCAG 2.1 A/AA reports no serious or critical violations;
- **the Mobbin pattern the screen was designed from** (workflow 10).

Screenshots and aria snapshots land in `test-results/page-sweep/`.

**Result: 19 screens × 2 viewports = 38/38 green.** Plus 5 journey specs, 43 Playwright tests in total.

| Screen | Route | Mobbin source (workflow 10) | Pattern checked |
|---|---|---|---|
| Home | `/` | Uber · Booking a ride | One primary entry ("What do you want to make?") with the upload |
| Make (upload) | `/make` | Uber · "Where to?" | Single entry point |
| Make AI | `/make/ai` | Make intake: prompt composer | Prompt box, "estimate, not a quote" |
| Configure + Quote | `/parts/:id` | DoorDash · Adding to cart | "Required" option groups; the sticky CTA counts missing choices |
| Manufacturing Route | `/build/:id/route` | Route: compare vendor cards | Recommended shop card, trust chip, partner offers |
| Checkout | `/checkout/:quoteId` | DoorDash · Placing an order | Shipping-method cards; every fee has an ⓘ |
| Order tracking | `/orders/:id` | Uber · ride in progress | One plain status sentence, ETA first, shop and passport |
| Production run | `/orders/:id/production` | DoorDash · order status stages | Milestone stages |
| Orders lookup | `/orders` | Uber · Activity | Find an order |
| Product Passport | `/passport/:id` | Certificate of authenticity with QR | Verified badge, QR |
| Build Workspace | `/build/:id/workspace` | 3D viewer + properties; version history | Status strip, trust badge, CAD panel |
| Shop Console | `/shop`, `/shop/jobs`, `/shop/jobs/:id`, `/shop/payouts` | Driver app job offer; kitchen display | Offer tabs, job status, payouts |
| Ops board, Sourcing desk | `/admin`, `/admin/sourcing`, `/admin/sourcing/jobs/:id` | Ops board | Queue, approvals, job detail |
| Not found | any unknown path | Empty state | h1, no crash |

**Bugs the sweep found and fixed (commit `61b8465`):**
- A closed ⓘ explainer kept its 240 px width, because `w-60` won over `sr-only`. Near the right edge that pushed phone pages sideways (Manufacturing Route). Open bubbles now also shift back inside the viewport.
- The Passport overflowed on phones: its grid's implicit column was sized to the QA table.
- The Passport's scrollable QA table was not keyboard reachable (axe `scrollable-region-focusable`).
- The Passport printed the thickness in mm twice.

**Gaps against the Mobbin board that only eyes catch** (now owned by the stages below):
- The home page is upload-first. The board calls for **one "What do you want to make?" bar plus a Make-anything tile grid** (Laser cut · Bend · CNC · 3D print · Wood · Reconstruct). → Stage 1
- There is no **mobile bottom nav** (Discover · Make · Live · Builds · Me); the header has a menu instead. → Stage 1 (Discover/Make/Builds/Me), Stage 3 (Live)
- These are not built yet: My Builds activity, onboarding, chat, Prime and Live. → Stages 1–4

**Rule from now on:** every new screen adds a `SCREENS` entry to the sweep with its Mobbin pattern assertion, in the same PR.

## 2. Mobbin board coverage

| Board pattern (workflow 10) | DiscoverMake screen | Status | Stage |
|---|---|---|---|
| DoorDash · Adding to cart | Configure sheet, required groups, CTA counter | ✅ built | — |
| DoorDash · Placing an order | Checkout, ⓘ fees, shipping cards with dates | ✅ built | — |
| DoorDash · floating cart pill, "Complete your build" upsells | Build cart + upsells (hardware kit, spare, powder coat) | ⬜ | 2 |
| DoorDash · rating at the end | Rate the build + post UGC | ⬜ | 2 |
| Uber · Booking a ride (single bar + tiles) | Home intake bar + Make-anything tiles | 🟡 upload-first | 1 |
| Uber · ride in progress (map + bottom sheet) | Tracking over a map or the 3D object, shop card | 🟡 no map | 2 |
| Uber · Message driver (quick replies) | Shop/creator chat with quick replies | ⬜ | 2 |
| Uber · Activity (Rebook) | My Builds with Reorder / Remix / Repair | 🟡 lookup only | 1 |
| Blinkist / Pinterest / Behance onboarding | 4-step onboarding, pick 5, deferred signup | ⬜ | 1 |
| Blinkist trial timeline | DiscoverMake Prime trial | ⬜ | 2 |
| Whatnot · live show | Live viewer: NOW SHOWING card, Make Mine / Remix / Buy, Build Slot | ⬜ | 3 |
| Whatnot · home live feed | Live home, channel chips, go-live checklist | ⬜ | 3 |
| Whatnot · seller profile | Creator/factory channel | ⬜ | 3 |
| Query backlog: creator analytics, studio controls | Creator Studio | ⬜ | 3–4 |
| Query backlog: certificate with QR | Passport | ✅ built | — |
| Query backlog: driver job offer / kitchen display | Shop Console | ✅ built | — |
| Query backlog: 3D viewer + properties, version compare | Build Workspace | 🟡 GLB not rendered yet | 1 |

**New references pulled for the next stages** (Mobbin search, 2026-10-08):
- **My Builds / Reorder:**
  - [Glovo · Orders with Reorder](https://mobbin.com/screens/6bafdf4d-e82d-480d-99bc-3df897295706)
  - [Subway · Order Again (Customize + Add)](https://mobbin.com/screens/d83737ad-a4e9-4ee7-bcc7-1b9fd924b25f): Customize maps to **Remix**, Add maps to **Reorder**
  - [Yami · Orders with status tabs](https://mobbin.com/screens/0306cb7c-e6fb-4106-8bb3-fd6c3bee69cc)
- **Prime trial timeline:**
  - [Copilot · Claim your free trial](https://mobbin.com/screens/b6ba77c0-7d8f-423e-8453-9db2a97f8035)
  - [Givingli · Try Premium (Today → Day 2 reminder → trial ends)](https://mobbin.com/screens/3b9243e4-291c-4077-8d18-4e3853da4854)
- **Order chat with quick replies:**
  - [Glovo · Help with an order](https://mobbin.com/screens/b4e51940-3b8c-4e6f-a792-4314eba30343)
  - [LinkedIn · quick-reply chips above the composer](https://mobbin.com/screens/0e046862-8ced-491d-ab7c-9ec71a34c566)
- **Tracking over a map:**
  - [Shop · Arrives Jul 31 with carrier card over a map](https://mobbin.com/screens/ac9223d8-b3bc-430b-b509-56b602c25de5)
  - [Glovo · Get ready, courier arriving](https://mobbin.com/screens/119ad0bc-ded5-4244-8f25-0dd99f944ae8)
  - [Waymo · bottom sheet with one status line](https://mobbin.com/screens/195d9f0f-47de-40ad-b896-6816b353017b)
- **Object View:** [Microsoft Copilot · 3D object with Recreate / Download panel](https://mobbin.com/screens/81380eb5-13d0-48dc-8726-fc49e62d638f)
- **Creator analytics:**
  - [SoundCloud · Insights](https://mobbin.com/screens/81f4a402-c167-4470-ab5d-23a892be6a5a)
  - [DoorDash Merchant · Product mix](https://mobbin.com/screens/0fce9fb1-1e7c-41c4-a2da-01535d9324e5)
  - [Square · Best selling items](https://mobbin.com/screens/7686972f-78b5-4316-a692-d0f0e411877c)

## 3. The stages

Each stage lists its scope, then its owner inputs, its G3 demo (exit gate) and the sweep entries it adds. Stages overlap: each stage's discovery spike starts during the previous stage's hardening (workflow 00).

### Stage 1 · R2 complete: "Make it yours" (accounts, onboarding, My Builds, Object View)
**Scope**
- **Accounts (ADR-0008 R2):**
  - passkey, Apple and Google sign-in via Supabase Auth, with deferred signup (Behance pattern);
  - a session claims guest builds and orders by their signed links;
  - owner-only edits and approvals replace every `TODO(R2 accounts)`;
  - roles: buyer, creator, shop, ops, admin.
- **Onboarding (4 steps, 60 s):**
  1. Intent: Make · Discover · Sell · Shop.
  2. Pick 5.
  3. First build, an instant quote in under 5 s.
  4. Save with a passkey.
- **Home intake (Uber pattern):** one "What do you want to make?" bar that routes text to Make AI and files to the quote engine, plus Make-anything tiles and recent builds.
- **App shell:** a mobile bottom nav (Discover · Make · Builds · Me now, Live in Stage 3), with the desktop top nav from workflow 10.
- **My Builds (500-1, 500-4):** All / Created / Remixed / Ordered / Following tabs, universal status pills, and **Reorder · Remix · Repair** on each row.
- **Build Workspace:**
  - Object View, the GLB rendered in r3f with measurements (600-3, 300-2);
  - Make AI panel (300-3);
  - an attachment tray for image and CAD files (100-1).
- **CAD:**
  - more families: U-channel, multi-bend bracket, plates with slots and countersinks;
  - cross-provider evals scored on "compiles + passes DFM" (100-4);
  - the workflow 01 acceptance test: the enclosure prompt produces all 11 artifacts (100-5).
- **Replacement-part quote from the Passport (1000-3).**
- **Hardening:**
  - a database trigger that makes approved graph rows immutable;
  - shared rate limiting (Upstash or Redis);
  - the in-app MCP route moves behind a per-workspace allowlist.

**Owner inputs:**
- Supabase project (Auth)
- Apple and Google OAuth apps
- Make AI key
- CAD worker host

**G3 demo:** a new visitor onboards, describes a bracket, answers two questions, approves it, generates CAD, gets a BINDING quote, signs in with a passkey at checkout, pays, and later reorders it from My Builds.

**Sweep adds:** onboarding (4 screens), home intake, My Builds, sign-in, Object View.

### Stage 2 · R3 "Prime": one price, one date, any part
**Scope**
- **Supplier-route ordering:**
  - a selected supplier-confirmed offer becomes a BINDING quote (offer + risk reserve);
  - deposit and purchase-order approvals;
  - a supplier fulfilment leg (inbound freight → partner shop or direct ship);
  - QA at receipt.
- **Delivery Promise engine** (workflow 03):
  - per-leg P90s;
  - "Arrives Thu, Oct 23", shown only when P90 ≤ that date;
  - an auto-credit on a missed promise;
  - weekly retraining.
- **OR-Tools** route comparison and dispatch batching (700-11).
- **More sourcing providers:** shop-stock and catalog distributor `SourcingProvider`s (700-8).
- **The OPA sidecar** replaces the TypeScript policy table, with the same rules.
- **Temporal** for long-running order and sourcing workflows (replaces ADR-0007 sweeps).
- **Prime membership:**
  - free shipping over a threshold, priority slots, guaranteed dates, pooled material pricing;
  - the trial-timeline paywall (Copilot / Givingli pattern).
- **Tracking over a map** with a carrier card (Shop / Glovo pattern), and address validation warnings at checkout.
- **Order chat:** buyer ↔ shop/ops, with quick replies such as "Approve change", "Send photo", "Hold production" (Glovo / LinkedIn pattern).
- **Build cart** with "Complete your build" upsells; **rating + UGC** after delivery.
- Live carrier rates at quote time; wire / ACH invoices for B2B.

**Owner inputs:**
- Prime pricing
- a credit policy
- carrier accounts
- the first catalog distributor API keys
- partner shops for receiving supplier freight

**G3 demo:** a buyer orders a 250-unit anodized part that no partner shop can make. Accio sources it, the buyer sees one price and one date, approves, pays a deposit, and tracks it on the map through import and QA to delivery. The promise hit rate is measured.

**Sweep adds:** Prime paywall, map tracking, chat, cart, rating.

### Stage 3 · R4 "Live": watch it made, make it yours
**Scope** (ADR-0003, workflow 06)
- LiveKit token service with scoped grants (800-1), rooms, roles, moderation and egress recording.
- **Live viewer (Whatnot pattern):**
  - a NOW SHOWING product card with Make Mine / Remix / Buy;
  - a Build Slot counter;
  - an action rail (like · ask · clip · share · cart);
  - chat over the video.
- **Live Build Protocol:** server-signed overlay events. Commerce state never goes into the video.
- Live home with channel chips (Mega Builds, Factory Floor, Drops) and a creator go-live checklist.
- Make AI as a LiveKit Agents co-host (Ask Make AI).
- **Creator Studio:** show planner and live control room (feature product, start drop, bring viewer on, clip) (400-3, 400-4).
- Owncast channels for scheduled programming; MediaMTX for factory and robot cameras (R4.5).

**Owner inputs:**
- LiveKit Cloud project
- Owncast host
- a first pilot creator and a pilot factory camera

**G3 demo:** a creator goes live building a lamp. A viewer taps Make Mine, configures a remix in the overlay, buys a Build Slot, and receives a real order tied to the same Build Graph.

**Sweep adds:** Live home, Live viewer, go-live checklist, control room.

### Stage 4 · R5 "Media": the manufacturing-to-media network
**Scope** (workflows 07, 08, 09)
- Channels: creator, factory and campus.
- **Clip engine:** auto-clips from egress, shoppable replays with the product pinned at its timestamp.
- **Drops and auctions** with fair-queue Build Slots.
- **Watch My Build:** the buyer's own production stream, with milestones auto-posted from the Shop Console.
- **Creator economics:**
  - remix licences and royalty %;
  - creator payouts through Stripe Connect (900-7 creator);
  - revenue and royalty dashboards (SoundCloud Insights / DoorDash Merchant pattern) (400-1, 400-2, 400-5).
- **Discover feed:** recommendations (Meilisearch search; Qdrant for similar builds), seeded by onboarding's "pick 5".

**Owner inputs:**
- creator terms (royalty split, licence text)
- content moderation policy
- a CDN and video storage budget

**G3 demo:** a replay clip sells a remix whose royalty is paid to its creator. The buyer's own build stream shows every milestone.

**Sweep adds:** Discover, channel page, replay player, clip card, creator dashboards.

### Stage 5 · R6 "Reconstruct": fix anything from a photo
**Scope** (workflow 01, spec §16)
- Photo, video or scan → SAM 2 segmentation → OpenCV measurement → COLMAP + Open3D geometry → text-to-CAD and CadQuery → **human dimension confirmation** → Build.
- A caliper-reading UI. Every critical dimension is confirmed by the buyer, never inferred.
- Replacement parts from a broken object, linked to its passport when one exists.

**Owner inputs:**
- GPU worker hosting
- a reconstruction accuracy target per category

**G3 demo:** a photo of a broken knob plus one caliper reading becomes a printable replacement with a BINDING quote.

**Sweep adds:** capture, reconstruction review, dimension confirmation.

### Cross-cutting · GA hardening (runs alongside Stages 1–2, gates the public launch)
- Monorepo move (`apps/web`, `services/*`, `packages/*`; 001-2).
- **Security:**
  - an AV scan and sandboxed parser for uploads (001-8);
  - secrets rotation (the Make.com session, the old Stripe key);
  - a pen test before GA.
- **Pricing:** the 50-part golden suite calibrated on real invoices, in CI (700-6). Until then BINDING stays gated per category.
- **Legal:** Terms, Privacy, Refunds, Prohibited items / export control, creator and shop agreements.
- **Observability and operations:**
  - tracing, error budgets, an on-call runbook;
  - load tests on quote, MCP and live paths;
  - backups and restore drills.
- Accessibility: a manual screen-reader pass on top of the automated sweep.
- **Mobile apps (optional, after Stage 3):** Expo shell over the shared TypeScript core, starting with tracking and Live.

## 4. Testing gate for every stage
1. `tsc`, `eslint --max-warnings=0`, vitest, CAD worker pytest.
2. Playwright journeys for the stage's demo script, with real state and no mocks on the critical path.
3. **Mobbin page sweep:** every screen at phone and desktop width. No overflow, no console errors, axe clean, and its Mobbin pattern asserted.
4. `next build`, plus a Vercel preview that is green.
5. A G3 demo on staging, recorded.

## 5. Order of work and rough size

| Stage | Depends on | Size (2-week sprints) |
|---|---|---|
| 1 · R2 complete | PR #2 merged | 3 |
| 2 · R3 Prime | Stage 1 accounts | 4 |
| 3 · R4 Live | Stage 1 accounts; R1 GA + R2 beta (workflow 00 gate) | 5 |
| 4 · R5 Media | Stage 3 | 5 |
| 5 · R6 Reconstruct | Stage 1 CAD families | 4+ |
| GA hardening | parallel | continuous |
