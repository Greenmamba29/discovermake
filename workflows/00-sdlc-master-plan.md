# 00 · SDLC master plan

DiscoverMake is big: a manufacturing marketplace, an AI design system, a logistics network and a live media platform. This plan therefore uses a **traditional, gated SDLC**, closest to a V-model. Implementation inside the gates runs in two-week sprints. The gates protect against the expensive failure modes: building live media before anyone can buy a part, or letting an LLM reach a machine without validation.

```
 0 INITIATION ─▶ 1 REQUIREMENTS ─▶ 2 DESIGN ─▶ 3 IMPLEMENTATION ─▶ 4 TEST ─▶ 5 DEPLOY ─▶ 6 OPERATE
      G0               G1               G2        (R1…R6 increments)   G4         G5          G6
                                                         G3 per increment
```

Each verification activity is paired with the definition it verifies (V-model):

| Left side (define) | Right side (verify) |
|---|---|
| Business case + success metrics (Phase 0) | Post-launch review against metrics (G6) |
| Software Requirements Spec (Phase 1) | System + acceptance tests, UAT (Phase 4) |
| Architecture + ADRs (Phase 2) | Integration + contract tests |
| Module design (Phase 2/3) | Unit tests, DFM/pricing golden tests |

---

## Phase 0 · Initiation and feasibility (weeks 1–2)

**Goal:** decide what we are building first and prove the unit economics before writing product code.

Activities
1. **Product charter.** Use the spec's thesis (the On-Demand Creation Operating System). The tagline is *Discover. Make. Build.*
2. **Brand decision.** Today the `discovermake` app is a Make.com template marketplace (see `docs/architecture/current-state.md`). Decide whether to retire it, spin it off, or keep it as a separate "automations" product. **This is an owner decision and it blocks G0.**
3. **Wedge decision.** The recommendation is that R1 is **SendCutSend parity for sheet parts**. Sheet parts are deterministic and price-able today. They make money on the first order and prove the MAKE Network. Live and media then sit on top of real transactions.
4. **Unit economics.** Model the price ladder and margin for 3 reference parts: a bracket, an enclosure panel, and the desk-lamp arm. Use the `anthropic-skills:unit-economics` skill or a spreadsheet. Inputs:
   - $/kg per material
   - laser $/hr
   - press brake $/bend
   - finishing $/ft²
   - shipping zones
5. **Partner feasibility.**
   - Sign letters of intent with 2–3 partner shops. Each needs a fiber laser, a press brake, and powder coat or a powder coat partner.
   - Confirm Accio access. There is no public API confirmed as of Oct 2026 (see ADR-0005).
6. **Legal scan.** Work through each area:
   - marketplace terms
   - creator IP and remix licensing
   - export control (ITAR / EAR screening on uploaded designs)
   - prohibited items (weapons parts, regulated items)
   - money transmission for payouts (use Stripe Connect)

**Exit gate G0:**
- charter signed
- R1 scope frozen
- 2+ shop LOIs
- unit economics positive at a 25% target contribution margin

## Phase 1 · Requirements and analysis (weeks 3–5)

Deliverables
- **SRS (Software Requirements Specification)** in `docs/product/srs.md`. Give each requirement an ID: `FR-<area>-<n>` for functional, `NFR-<n>` for non-functional. Source requirements from the V1 spec sections 7–13 and from workflows 01–09.
- **User journeys** for these roles: buyer, creator, shop operator, live viewer, admin/ops.
- **Domain model**: the canonical entities from spec section 5. Freeze the names here; renaming later is expensive.
- **Non-functional requirements (NFRs):**

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Instant quote latency, DXF ≤ 5 MB | p95 ≤ 4 s |
| NFR-2 | Quote accuracy vs. final shop invoice | ±8% on R1 catalog |
| NFR-3 | Live product-event fan-out latency | p95 ≤ 400 ms |
| NFR-4 | Checkout availability | 99.9% monthly |
| NFR-5 | Delivery Promise hit rate | ≥ 95% on-time |
| NFR-6 | Accessibility | WCAG 2.2 AA on all purchase paths |
| NFR-7 | Security | OWASP ASVS L2; no secrets in git; SOC 2-ready logging |
| NFR-8 | Mobile | All five surfaces usable at 375 px; LIVE full-screen vertical |

- **Traceability matrix** started in `workflows/12-qa-release-operations.md`. It maps requirement → test → release.

**Exit gate G1:** SRS baselined and signed off by the product owner. Every R1 requirement has acceptance criteria.

## Phase 2 · System design (weeks 6–9)

Deliverables
- **Architecture:** `docs/architecture/target-state.md` plus ADRs 0001–0006 (already drafted).
- **API and event contracts:**
  - `contracts/*.schema.ts`, using zod
  - the Live Build Protocol event catalog (workflow 06)
  - the domain event envelope (ADR-0002)
- **Data design:**
  - Postgres schema for the Build Graph, orders and quotes
  - Firestore → Postgres migration plan (ADR-0006)
- **UX design:**
  - the Mobbin reference board and flows (workflow 10)
  - hi-fi screens for R1 and R2
  - a design system package with tokens
- **Threat model** (STRIDE) for:
  - file upload
  - payment
  - payouts
  - live ingest
  - shop adapters
- **Test strategy** (workflow 12).

**Exit gate G2:** a design review covering architecture, security and UX. Every R1 story is estimable.

## Phase 3 · Implementation (incremental releases)

Sprints are two weeks. Each release ends with **G3**: a demo of its acceptance script on staging using real data on its critical path (spec section 28, the no-fake-state rule).

| Release | Weeks | Scope | Key workflows |
|---|---|---|---|
| **R1 Cut** | 10–19 | Foundation, auth, Build entity, file upload, DXF/STEP parse, DFM, instant quote, checkout (Stripe), shop adapter v1 (portal + email), order tracking, Product Passport v0 | 02, 04, 05, 09, 11 |
| **R2 Make + Source** | 18–27 | Make AI intake, requirements, Build Graph, CAD worker (text-to-CAD / CadQuery), Build Workspace, materials engine, makeability; **Accio bridge MCP server + Accio Work agent group**, quote trust levels, supplier offers on the Route screen | 01, 03, 04 |
| **R3 Prime** | 24–31 | Delivery Promise engine, OR-Tools route optimization, shop-stock and catalog providers, membership | 03, 05 |
| **R4 Live** | 28–37 | LiveKit rooms, MediaMTX ingest, Live Build Protocol, product pinning, Make This / Remix / Buy / Build Slot in stream, Creator Studio show control | 06, 08 |
| **R5 Media** | 34–43 | Channels, clip engine, shoppable replays, drops and auctions, Watch My Build, factory channels | 07, 08, 09 |
| **R6 Reconstruct** | 40+ | Photo/scan → geometry → parametric CAD with human confirmation | 01 |

The releases overlap on purpose. Each release's discovery spike starts during the previous release's hardening.

Definition of done for every story:
- typed contracts
- tests
- events emitted
- a11y checked
- feature flag
- docs updated
- no mock data on the critical path

## Phase 4 · Testing (continuous, with formal exits per release)

- Unit, contract, integration and e2e testing (Playwright is already a dev dependency).
- **Golden-part suite:** 50 real DXF/STEP files with known shop invoices. The quote engine must stay within ±8% (NFR-2).
- **System test** on staging, using test-mode Stripe and a sandbox shop adapter.
- **UAT:** 10–20 design partners per release. R1 partners are makers and small hardware startups.
- **Security:** dependency audit, SAST, and a pen test before R1 GA and again before R4 (live ingest is a new attack surface).

**Exit gate G4:**
- zero open Sev-1/Sev-2 defects
- golden suite passing
- performance NFRs met
- a11y audit passed

## Phase 5 · Deployment

1. **Internal alpha.** Staff orders for real parts, paid with company cards.
2. **Closed beta.** Invite-only with design partners and capped order value.
3. **GA.** Public launch per release, behind feature flags with a staged rollout.

Each stage ships with:
- runbooks
- an on-call rota
- a rollback plan
- comms: changelog, email to the waitlist, and a launch livestream (for R4 and later)

**Exit gate G5:** go-live readiness review. Ops, support, finance and legal all sign off.

## Phase 6 · Operations and maintenance

- SLOs and alerting: quote latency, checkout errors, adapter failures, Promise misses.
- Weekly quote-accuracy review: compare quote to invoice and tune the pricing coefficients.
- Monthly shop scorecards: on-time rate, defect rate, rework.
- Change management: ADR for architectural changes, RFC for pricing-model changes.

**G6, post-launch review at +30 days for each release:**
- metrics vs. charter
- defects
- customer feedback
- go/no-go for the next release's scope

---

## V1 definition of done

V1 is done when the 20-step scorecard DoD (`docs/product/DISCOVERMAKE_MVP_SCORECARD_OPEN_SOURCE_ACCIO.md` §25) passes end to end on staging with no mocked state. The steps run from describe a product, through Accio offers, pay, produce and live remix, to Passport. Two loops get tested repeatedly:

1. **Describe → Generate → Engineer → Source (Accio) → Quote → Approve → Pay → Produce → QA → Ship → Passport**
2. **Publish → Go Live → Make This / Remix → Claim Build Slot → Manufacture**

**V1 categories are narrow on purpose:**
- laser/sheet parts (R1 wedge)
- CNC-machined parts
- 3D-printed parts
- simple wood products
- simple sewn/textile items
- packaging
- basic electronics assemblies via external suppliers
- simple multi-part consumer assemblies

Yachts, submarines, aircraft and regulated products are media and partnership stories in V1. They are not autonomous production claims.

## Competitive position (strategy scores, not benchmarks)

| Platform | Score /100 | Wins today |
|---|---|---|
| DiscoverMake target V1 | 91 | Creation + manufacturing + Live + remix + creator economy |
| Xometry | 71 | Industrial quoting, capacity, quality, supplier network |
| Fictiv | 68 | DFM, materials intelligence, managed manufacturing |
| Desmake | 67 | Creator → on-demand → distributed fulfillment (closest architectural threat) |
| MakerVerse | 64 | Drawing intelligence, binding quote |
| Protolabs | 63 | Fast, reliable digital manufacturing |
| Dough | 59 | Prompt → consumer physical-product business |
| DiscoverMake current MVP | 28 | Early creation and project workflow |

Nobody in this group has the full Watch → Ask → Remix → Quote → Buy → Manufacture → Watch Yours Being Made → Passport loop. The moat is the compound dataset that real orders produce (scorecard §26).

## Roles (RACI summary)

| Role | Owns | R/A on gates |
|------|------|--------------|
| Founder / Product Owner | Charter, scope, pricing policy, brand | A: G0, G1, G5 |
| Engineering lead | Architecture, ADRs, code quality, releases | A: G2, G3 · R: G4 |
| Design lead | Mobbin board, design system, UX research | R: G2 |
| ML / AI lead | Make AI, CAD worker, materials engine, evals | R: R2, R6 |
| Manufacturing ops lead | Shop network, DFM rules, QA standards, Promise | R: G0 feasibility, R1, R3 |
| QA lead | Test strategy, golden suite, traceability | A: G4 |
| Security / compliance | Threat model, secrets, export-control screening | C on every gate · veto on G5 |

## Top risks

| Risk | Mitigation |
|------|-----------|
| Quotes drift from real shop cost | Golden-part suite, weekly calibration, shop-confirmed quote for anything outside the catalog |
| Accio has no inbound API | Inverted control: Accio Work calls our MCP server (ADR-0005). Sourcing desk and other providers are the fallback |
| An AI estimate gets mistaken for a real quote | Quote trust labels on every price (AI estimate → supplier estimate → supplier-confirmed → binding); only binding/approved quotes are orderable |
| Live launches before commerce works | Gate: R4 cannot start until R1 GA and R2 beta |
| LLM output reaches a machine | Spec §29 guardrail: structured plan → deterministic validation → policy → human approval → signed job |
| Prohibited or export-controlled designs | Upload screening, keyword/geometry classifiers, human review queue, ToS |
| Brand confusion with the Make.com template marketplace | G0 brand decision |
| Secrets already leaked in repos | Rotate now (see `11-platform-security-infra.md` §Immediate actions) |
