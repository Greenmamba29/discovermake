# Launch readiness: the whole app, end to end

**As of 2026-10-10.** Every stage in `workflows/14-completion-plan.md` is built and integrated on one branch.

## What a customer can do

| Area | Screens | What works end to end |
|---|---|---|
| **R1 Cut** | `/`, `/make`, `/parts/:id`, `/checkout/:quoteId`, `/orders/:id`, `/passport/:id`, Shop Console, `/admin` | DXF upload → DFM → BINDING instant quote → Stripe checkout → dispatch → shop milestones → QA → label and tracking → Product Passport → payouts |
| **Stage 1 · Make it yours** | `/onboarding`, Home intake and tiles, `/discover`, `/signin`, `/me`, `/builds`, `/build/:id/workspace` | **Accounts:** email code, passkeys, Google/Apple; guest builds claimed on sign-in; owner-only edits.<br>**Onboarding:** 4-step, 60 seconds.<br>**My Builds:** Reorder, Remix and Repair.<br>**Workspace:** Object View (3D with measuring), Ask Make AI, attachments.<br>**CAD:** 7 families. |
| **Stage 2 · Prime** | Manufacturing Route tabs, supplier checkout, `/prime`, `/me/membership`, cart, map tracking, order chat, rating, invoices | **Supplier routes:** a supplier-confirmed offer becomes a BINDING quote; deposit, then PO approval, then the supplier leg, then QA at receipt.<br>**Delivery Promise:** per-leg P90 dates, with an auto-credit when a date is missed.<br>**Prime:** 7-day trial.<br>**Checkout:** cart with engine-priced upsells, ratings with photos, tracking map, chat with quick replies, B2B invoices. |
| **Stage 3 · Live** | `/live`, `/live/:showId`, `/studio`, `/studio/shows/:id` | **Live Build Protocol** with signed events, plus shoppable replays.<br>**Viewer actions:** Make Mine, Remix, Buy, Ask Creator, Ask Make AI.<br>**Drops:** Build Slots are authorized when claimed, captured when the threshold is met, and released when it is not.<br>**Hosting:** LiveKit tokens and moderation. |
| **Stage 4 · Media** | `/discover` feed, `/b/:id`, `/c/:handle`, clips, `/studio/insights`, payouts, `/orders/:id/watch`, auctions | **Creators:** publishing with remix licences, royalties on remixes and drops, Stripe Connect payouts, insights.<br>**Content:** clips cut from replays.<br>**Selling:** fair-queue drops and anti-snipe auctions.<br>**Watch My Build:** the buyer follows their own order live.<br>**Discover:** a ranked feed with search. |
| **Stage 5 · Reconstruct** | `/reconstruct`, measurement, caliper confirmation, `/reconstruct/:id` review | **Measure:** the buyer photographs the broken part and sets the scale from a reference object.<br>**Confirm:** every critical dimension is confirmed with a caliper reading; nothing is ever inferred.<br>**Make it:** printed CAD (knob, spacer), then a BINDING 3D-print quote, then an order. |

## Test evidence (final integrated tree)

| Gate | Result |
|---|---|
| `tsc --noEmit`, `eslint --max-warnings=0` | clean |
| vitest (unit and integration against real Postgres) | **879 tests, 120 files, all passing** |
| CAD worker pytest (CadQuery, golden DXF/STEP/STL, workflow 01 acceptance) | **87 passing** |
| `next build` | compiles cleanly; the production server sends every security header |
| Playwright, desktop project | every journey (R1 order, accounts with a passkey, onboarding, workspace, sourcing over MCP, Prime supplier and Prime experience, Live, Media with an auction, Reconstruct) plus the page sweep |
| **Mobbin page sweep** | every screen at **390 px phone** and **1280 px desktop**. Each screen is checked for:<br>• one h1 and a main landmark<br>• no console errors or unexpected HTTP failures<br>• no horizontal overflow<br>• axe WCAG 2.1 A/AA with no serious or critical issues<br>• its Mobbin pattern<br>• bottom-nav presence |
| Phone emulation (Pixel 7 and iPhone 14 profiles, touch and mobile UA) | the buyer journeys rerun on both profiles: order, accounts, Live, Media (clip to remix order, auction), Prime experience and Reconstruct. The mobile-touch spec checks 44 px tap targets and a tap-only path from quote to checkout with the sticky CTA in view. |
| Keyboard | skip link, tab order to the main intake, visible focus ring |
| Load (`bun run load:test`, local production build, 20 users) | health p95 32 ms; catalog p95 118 ms; full quote flow p95 1109 ms at 21 flows/s; 0 errors |
| Backup and restore drill (`bun run ops:restore-drill`) | PASS: 100 tables with identical row counts, restored in 2 s |
| Security | CSP, HSTS, nosniff, frame denial; ClamAV upload scan that fails closed in production; trusted-proxy client IPs; shared Postgres rate limits; approved Build Graph rows immutable in the database; MCP tool and CIDR allowlists; HMAC-signed Live commerce events |
| Code review (Kilo on PR #2) | every finding fixed or answered with a reason, and every thread resolved |

## Owner inputs to go live

All of these are configuration and accounts; the code paths exist and are tested with the dev doubles. Each one is described in the area's doc.

**Infrastructure**
- Production Postgres. Run `bun run db:migrate` to apply 0000–0011 and the manual immutability trigger.
- S3-compatible storage with bucket versioning.
- ClamAV `clamd`. Set `CLAMAV_HOST` and `UPLOAD_SCAN_REQUIRED=true`.
- `TRUSTED_PROXY` if you deploy anywhere other than Vercel.

**Secrets**
- `ORDER_LINK_SECRET`, `PASSPORT_SIGNING_SECRET`, `JOB_PACKET_SIGNING_SECRET`, `STORAGE_SIGNING_SECRET`
- `AUTH_SECRET`, `LIVE_EVENT_SIGNING_SECRET`
- `ADMIN_TOKEN`, `CRON_SECRET`
- `ADMIN_EMAILS` for ops sign-in.

**Payments**
- Stripe keys and the webhook secret, with subscription and invoice events enabled.
- Stripe Connect for shops and creators.
- The Prime recurring Price ids.
- ACH and bank transfer turned on for invoices.

**Shipping and email**
- EasyPost key and webhook secret.
- Resend key and sending domain.

**Sign-in**
- Google and Apple OAuth apps (optional; email code and passkeys work without them).

**AI and CAD**
- `GOOGLE_GENERATIVE_AI_API_KEY` for Make AI.
- Deploy the CAD worker container, then set `CAD_WORKER_URL` and `CAD_WORKER_TOKEN`.

**Live**
- A LiveKit Cloud project (`LIVEKIT_*`), or an HLS source per show.

**Sourcing**
- An Accio Work workspace: register the MCP server with a client token from `/admin/sourcing`.

**Business decisions**
- Prime prices.
- Deposit, margin and risk-reserve percentages.
- The missed-promise credit policy.
- The creator royalty rules.
- Print pricing calibration from real invoices.
- The map style URL.

**Legal**
- Counsel reviews the four documents in `src/lib/legal.ts`, then set `NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE` (see `legal-inventory.md`).
- Retention periods per data class.
- Denied-party screening for export control.

## Deliberately deferred (documented in each stage doc)

These are infrastructure choices or need real-world data. They are not missing features.
- **Policy and workflows:**
  - The OPA sidecar (rules live in a tested TypeScript policy table).
  - Temporal (Postgres state machines and the outbox are used instead).
- **Media pipeline:**
  - MediaMTX/Owncast ingest hosting.
  - LiveKit Agents voice co-host.
  - CDN transcoding for clips.
- **Learned models** (heuristics with impression logging are in place):
  - A learned feed ranker.
  - Delivery Promise models trained on real deliveries (falls back to lead-time estimates until about 5 deliveries per scope).
- **GPU segmentation** (SAM 2/COLMAP): a client interface and contract are in place; manual measurement is complete without it.
- **Distributor-backed quoting:** the Mouser adapter is gated on its key.
- **Royalties:** paid to the direct parent creator only.
- **Expo mobile apps:** optional, after GA. The web app is mobile-first and tested on phone profiles.
