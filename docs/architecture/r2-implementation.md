# R2 "Make + Source": implementation (increment 1)

**Status (2026-10-07):** built on top of R1 (PR #1, merged). It covers ideation → Build → CAD → instant quote, and the Accio Work sourcing bridge with a human approval boundary.

**Verification:**
- `tsc`, `eslint`: clean
- vitest: 381 tests in 55 files
- CAD worker pytest: 18
- Playwright: 5 journeys, R1 included
- `next build`: passes

## What a customer can do now

```
Describe it (/make/ai) ─▶ Make AI CreationIntent (persisted) ─▶ Continue to Build
   ─▶ Build Workspace v1 (requirements, NEEDS_INPUT questions, catalog materials)
   ─▶ answer questions (new version each time) ─▶ approve version (immutable)
   ─▶ Generate CAD (Make AI spec or buyer dimensions) ─▶ STEP / DXF / GLB + new version
        ├─ sheet part ─▶ /parts/:partId instant quote ─▶ BINDING ─▶ R1 checkout → order
        └─ anything else ─▶ "Find manufacturing partners" ─▶ Accio Work (MCP) ─▶ offers
Upload a DXF (R1) whose quote is REVIEW ─▶ sourcing job queued automatically ─▶ Accio Work
Partner offers on the Manufacturing Route (trust-labelled, no supplier identity)
   ─▶ buyer chooses a SUPPLIER-CONFIRMED offer ─▶ ops approves ─▶ route confirmed
```

Ordering through a supplier route (deposit, PO, supplier fulfilment leg, Delivery Promise) is **R3**. In R2, checkout still accepts BINDING quotes only.

## Modules

| Area | Code | Notes |
|---|---|---|
| Build Graph | `src/server/build-graph/` | Copy-on-write graph per `design_version` (`bg_nodes`, `bg_edges`). APPROVED versions are never mutated. Diff by stable node key; remix/clone lineage; derived trust state (CONCEPT → ORDERABLE) |
| Make AI → Build | `src/server/make-ai/{builds,materials}.ts` | Intents are persisted (sha256 and length only, no prompt). The Materials Engineer may only answer with a catalog slug or `needs_sourcing` |
| Workspace UI | `src/components/workspace/`, `/build/:id/workspace` | Overview (next step, CAD, sourcing), Requirements, Questions, Materials, Parts, Graph (with version diff), Versions (approve), Remix / Make This |
| CAD worker | `services/cad-worker/` (Python, CadQuery) | `sheet_panel`, `l_bracket`, `enclosure`, and since Stage 1 `u_channel`, `multi_bend_bracket`, `slotted_plate`, `sheet_enclosure`. Bounded specs, process timeout, reproducible DXF/STEP using the R1 layer conventions, plus BOM (JSON + CSV), SVG drawing and a sha256 manifest on every result |
| CAD in the app | `src/server/cad/` | Client (sha256 and size checks), CAD agent (refuses untraceable dimensions), pipeline (stores artifacts, attaches one quotable part per flat pattern), estimate (R1 Makeability, price range, production time), build CAD (writes a new version with decomposition, BOM, processes and the preliminary quote) |
| Sourcing bridge | `src/server/sourcing/`, `POST /api/mcp/sourcing` | 9 MCP tools, leases, policy, offers and trust, approvals, signed REDACTED package, audit, auto-request on REVIEW quotes |
| Sourcing UI | `src/components/sourcing/`, `src/components/trust/`, `/admin/sourcing` | Buyer panel and partner routes; ops desk (queue, job detail, approvals, desk fallback, Accio clients) |
| Accio config | `mcp/discovermake-sourcing/` | Agent-group prompts and schedule, setup README |
| CAD evals | `evals/cad/` | 14 recorded cases, `bun run eval:cad` (offline replay or live across providers), JSON + markdown scorecard |
| Rate limiting | `src/server/rate-limit/` | Shared fixed-window and token-bucket limiters (Postgres or memory) behind every limited route |

## API surface (new in R2)

**Build Graph and Make AI** (public, like the other build routes; per-IP limits on writes):
- `POST /api/make-ai/builds { intentId }` → `{ buildId, displayId, created }`
- `GET /api/builds/:id/graph?version=` → `BuildGraphView`
- `GET /api/builds/:id/graph/diff?from=&to=` → `BuildGraphDiff`
- `POST /api/builds/:id/answers { answers: [{ unknownKey, value }] }` → new version
- `POST /api/builds/:id/versions/:v/approve`
- `POST /api/builds/:id/remix` and `POST /api/builds/:id/clone` → `BuildForkResponse`
- `GET | POST /api/builds/:id/cad { spec? }` → `BuildCadResponse`. POST returns 501 without `CAD_WORKER_URL`, and 409 unless the latest version is approved with no open questions

**Sourcing, buyer:**
- `GET | POST /api/builds/:id/sourcing`
- `POST /api/builds/:id/sourcing/offers/:offerId/select`

**Sourcing, ops** (`ADMIN_TOKEN`):
- `GET | POST /api/admin/sourcing/clients` (POST takes optional `allowedTools`, `allowedCidrs`), `DELETE /api/admin/sourcing/clients/:id`
- `PUT /api/admin/sourcing/clients/:id/allowlist { allowedTools, allowedCidrs }` (null = unrestricted)
- `GET | POST /api/admin/sourcing/jobs`, `GET /api/admin/sourcing/jobs/:id`
- `POST /api/admin/sourcing/jobs/:id/{cancel,requeue,suppliers,offers}`
- `GET /api/admin/sourcing/approvals`, `POST /api/admin/sourcing/approvals/:id/decision`

**MCP** (Accio Work, `Bearer dmsc_…`): `POST /api/mcp/sourcing` exposes these `discovermake.sourcing.*` tools:
- `next_job`, `get_job`, `get_attachments`
- `submit_supplier`, `submit_offer`, `update_negotiation`
- `attach_document`, `request_approval`, `complete_job`

**Events:**
- Build Graph: `build.forked`, `design.version_created`, `design.version_approved`, `requirements.generated`, `material.recommended`
- CAD: `cad.generated`, `makeability.completed`, `quote.preliminary`
- Sourcing jobs: `sourcing.requested`, `sourcing.job_leased`, `sourcing.lease_released`, `sourcing.completed`, `sourcing.cancelled`
- Suppliers and offers: `sourcing.supplier_found`, `sourcing.offer_received`, `sourcing.offer_stale`, `sourcing.negotiation_updated`, `sourcing.document_attached`, `sourcing.package_accessed`
- Approvals: `sourcing.approval_requested`, `sourcing.approval_decided`, `sourcing.boundary_blocked`, `supplier.selected`

## Rules enforced in code

- **No invented dimensions.** The CAD agent may only use numbers the buyer stated: user-sourced requirements and answered questions. Anything else becomes an open question in a new version, and holes the buyer never placed are dropped and listed.
- **No model-written CAD code.** The worker takes a strict, bounded spec. Unknown fields are rejected, and each generation runs in a killable process.
- **Approval boundary.** Accio can search, RFQ, negotiate within bounds, submit offers and request approvals. It cannot purchase, pay, release the full package, accept substitutions or tolerance changes, or pick the winner. Those paths return `APPROVAL_REQUIRED` and are recorded as `sourcing.boundary_blocked`.
- **Customers never see the supplier.** Route offers show region, verification, price, dates and the trust label only.
- **Trust labels are honest.** AI estimate and supplier estimate are never orderable. Supplier-confirmed can be chosen, and ops confirms it. Only BINDING goes to checkout.

## Stage 1: CAD families, evals, acceptance and hardening

**Verification (2026-10-09, this increment):**
- `tsc`, `eslint`: clean
- vitest: 482 tests in 63 files
- CAD worker pytest: 64
- `sourcing-journey.spec.ts` e2e: green
- The acceptance test and evals also pass against a live local worker (`CAD_WORKER_URL`)

### CAD families (worker 0.2.0)

| Family | What it makes | Flat patterns |
|---|---|---|
| `u_channel` | Base + two flanges bent the same way | One DXF, two `BEND_90_UP` lines |
| `multi_bend_bracket` | Z, hat and open profiles: 1-4 bends of +90 / -90, flange lengths in order | One DXF, `BEND_90_UP` / `BEND_90_DOWN` per bend |
| `slotted_plate` | Plate with round holes, obround slots and countersunk holes | One DXF; countersinks cut at their through-diameter (the cone is in STEP/GLB and in the BOM notes) |
| `sheet_enclosure` | Bent aluminium/steel box: U-channel body, two riveted end caps, lid with drip lips, optional floor holes and a cable-gland hole | One DXF per distinct panel; rivet and screw holes placed by the worker and aligned across panels |

- One bend-profile engine builds the folded solid and the K-factor flat pattern from the same numbers. Bounds mirror the R1 DFM: the flat flange is at least 4 x thickness, and every hole keeps one thickness from edges, bend zones and its neighbours.
- No `COUNTERSINK` DXF layer: the R1 parser treats every non-annotation layer as cut geometry, so an extra layer would be cut.
- Every result also ships `bom.json`, `bom.csv`, a dimensioned `drawing.svg` and a `manifest.json` with the sha256 of every artifact. DXF and STEP bytes are reproducible.
- `src/contracts/cad.ts` mirrors every bound, including the cross-field checks. The CAD agent proposes every family. Only buyer numbers within 0.5 mm become lengths; holes, slots, countersinks, floor holes and glands are kept only when the buyer placed and sized them, otherwise they are dropped and listed.
- Golden DXFs for every family quote BINDING in the R1 engine (`tests/cad/cad-worker-quote-families.test.ts`).

### CAD evals (100-4)

- `evals/cad/cases.json` holds 14 buyer requests: every family, inches, a dropped invented hole, two needs-input cases and two not-supported cases. Each has the buyer numbers, the expected outcome and spec, and a recorded model proposal.
- `bun run eval:cad` replays the recorded proposals (offline), or runs the real CAD agent across providers when keys are set:
  - Google: `GOOGLE_GENERATIVE_AI_API_KEY`
  - the Vercel AI Gateway: `AI_GATEWAY_API_KEY`, models in `CAD_EVAL_GATEWAY_MODELS`
  - `@ai-sdk/anthropic` / `@ai-sdk/openai` only if installed (they are not; those providers are skipped and listed).
- Each case goes through `guardProposal` → `CadSpec` → the CAD worker (live when `CAD_WORKER_URL` is healthy, else `evals/cad/golden`) → the R1 analyzer and quote engine.
- Scoring is "right outcome + compiles + passes DFM (BINDING, no blocking violation) + traceable". The scorecard goes to `.data/evals/cad/latest.{json,md}`.
- `tests/evals/cad-evals.test.ts` runs the offline mode in CI.

### Workflow 01 acceptance (100-5)

`tests/cad/workflow-01-acceptance.test.ts` runs "Make me a weatherproof outdoor enclosure for a Raspberry Pi with a solar battery" through intake, Continue to Build, answers (180 x 120 x 70 mm, 12.5 mm gland, 10 units), approval and CAD. It asserts that all eleven artifacts are persisted:

| # | Artifact | Where it lives |
|---|---|---|
| 1 | Structured requirements | REQUIREMENT nodes |
| 2 | Missing-info list | UNKNOWN nodes |
| 3 | Part decomposition | `part:*` PART nodes under `part:main` (four panels + purchased hardware) |
| 4 | Materials | MATERIAL nodes |
| 5 | Initial CAD | STEP, GLB and four DXFs in storage, with their sha256 |
| 6 | Preliminary BOM | `part:main.data.bom`, `bom.json`, `bom.csv` |
| 7 | Process recommendation | Catalog PROCESS nodes required by `part:main` |
| 8–10 | Makeability score, price range, production time | `quote:preliminary` QUOTE node, from real BINDING R1 quotes per panel |
| 11 | A persistent Build | `builds` row, versions and domain events |

The models are replaced by their recorded structured outputs. The worker is the live one when configured, else its recorded output in `tests/fixtures/cad/acceptance`. The worker-side share is also checked in pytest (`tests/test_acceptance_enclosure.py`).

### Hardening

- **Immutable approved graph rows.** `database/migrations/manual/0005_approved_graph_immutable.sql` is applied by `migrateDatabase` after the drizzle migrations, on every run, and is idempotent. It rejects any INSERT/UPDATE/DELETE on `bg_nodes`/`bg_edges` of an APPROVED or SUPERSEDED version. It also rejects un-approving or editing an approved version row, and deleting frozen versions (SQLSTATE `DM001`). Whole-build cascades still work.
- **Shared rate limiting.** `src/server/rate-limit` provides fixed-window and token-bucket limiters. The Postgres store does one atomic `INSERT … ON CONFLICT DO UPDATE` per hit on `rate_limit_buckets`, stores keys as sha256 and sweeps stale rows lazily. `RATE_LIMIT_STORE=postgres|memory` picks the store; the default is postgres in production and memory elsewhere. Make AI intake, Build Graph writes (including CAD), buyer sourcing requests and the MCP token bucket all use it.
- **MCP allowlist.** `sourcing_clients.allowed_tools` and `allowed_cidrs` (null means unrestricted).
  - A token used from an IP outside its ranges gets 403 (JSON-RPC `-32003`, audited). The IP comes from the shared `clientIp` helper, so a prepended `x-forwarded-for` hop cannot spoof it.
  - Disallowed tools are left out of `tools/list` and refused with `TOOL_NOT_ALLOWED`.
  - Set both at creation, with `PUT /api/admin/sourcing/clients/:id/allowlist`, or in the Accio clients panel.

## Where R2 deliberately differs from the plan

| Plan | R2 increment 1 | Why / next |
|---|---|---|
| `services/accio-bridge` as its own service | Route inside the web app | One deployable. Split it out when traffic warrants |
| OPA sidecar for the boundary | TypeScript policy table with tests | Same rules. OPA in R3 |
| Temporal workflows | Postgres state machines and the outbox (ADR-0007) | R3, with supplier fulfilment legs |
| 11-section workspace nav | 7 sections, only those with real data | No placeholder features |
| Object View (r3f) | GLB is downloadable, not yet rendered | Next increment |
| Rate limits (Upstash / Redis) | Postgres table `rate_limit_buckets` (Stage 1) | No new service: one atomic upsert per hit; swap the store if Postgres load demands it |
| Make AI intent ids `mki_…` | UUIDv7 (the frozen contract types `intentId` as a UUID) | Harmless; revisit with accounts |

## Owner actions to switch R2 on

1. Run `bun run db:migrate` in production (applies `0003_r2_build_graph_sourcing`, `0004_stage1_hardening` and the idempotent trigger file in `database/migrations/manual/`). Leave `RATE_LIMIT_STORE` unset in production (defaults to `postgres`).
2. **Make AI:** set `MAKE_AI_ENABLED=true`, `NEXT_PUBLIC_MAKE_AI_ENABLED=true` and `GOOGLE_GENERATIVE_AI_API_KEY`, and verify `MAKE_AI_MODEL`.
3. **CAD worker:** deploy `services/cad-worker` (Dockerfile) to Fly.io, Render or Cloud Run with `CAD_WORKER_TOKEN`. Then set `CAD_WORKER_URL` and `CAD_WORKER_TOKEN` in Vercel.
4. **Accio Work:**
   1. In `/admin/sourcing` → Accio clients, create a client and copy the one-time token.
   2. In your Accio Work workspace, register the MCP server `${APP_URL}/api/mcp/sourcing` with that bearer token.
   3. Paste the agent group from `mcp/discovermake-sourcing/accio-agent-group.md` and schedule the Procurement Lead (every 15 minutes).
5. Ops checks `/admin/sourcing` for pending approvals. The ops board links to it with a count.

## Next increments

- Object View (GLB in r3f).
- R2 accounts: owner-only edits and approvals, replacing the `TODO(R2 accounts)` markers.
- Live CAD eval runs on staging once provider keys are configured (recorded proposals only so far).
- Supplier-route ordering, OR-Tools route comparison and the Delivery Promise (R3).
