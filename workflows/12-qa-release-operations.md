# 12 · QA, release + operations

## Test strategy (V-model mapping)

| Level | What | Tooling | Gate |
|---|---|---|---|
| Unit | Pricing functions, DFM rules, unfolding math, event reducers | Vitest / pytest | Every PR |
| Contract | zod schemas in `contracts/` vs. producers and consumers; Live Build Protocol fixtures | Vitest + schema snapshots | Every PR |
| Golden parts | 50 real DXF/STEP parts with shop invoices. Quote must be within ±8% and DFM must match the expected violations | pytest + CSV fixtures | Every PR touching quote-engine |
| Integration | Order workflow with Stripe test mode, sandbox shop adapter, carrier sandbox | Temporal test env | Nightly + release |
| Event replay | Re-run recorded event streams and assert identical Build/Order state | Custom harness | Release |
| E2E | Spec §30 demo scenario, end to end in a browser | Playwright (already a dev dependency) | Release (G3/G4) |
| Live load | 10K simulated viewers, 50 events/s fan-out, p95 ≤ 400 ms | LiveKit load tester | R4 |
| Performance | Quote p95 ≤ 4 s; Core Web Vitals on Discover/Live | k6, Lighthouse CI | Release |
| Accessibility | WCAG 2.2 AA on purchase paths | axe + manual screen reader | Release |
| Security | SAST, dependency audit, secret scan, pen test (R1, R4) | CodeQL, gitleaks, external firm | Release |
| UAT | Design partners run real orders | Scripts + feedback form | G4 |

## Traceability matrix (seed)

| Requirement | Source | Test | Release |
|---|---|---|---|
| FR-QUOTE-1 Upload DXF → price < 4 s | wf 02 | perf + e2e `quote.spec.ts` | R1 |
| FR-QUOTE-2 DFM violations with fixes | wf 02 | golden parts + unit | R1 |
| FR-ORDER-1 Pay & start production creates Order + Payment + approved DesignVersion + event | spec §12.4 | integration `order.workflow.test` | R1 |
| FR-SHOP-1 Shop accept → buyer sees milestone ≤ 5 s | wf 05 | integration | R1 |
| FR-PASS-1 Passport generated from real records | wf 09 | e2e | R1 |
| FR-MAKE-1 Enclosure prompt → 11 artifacts persisted | spec §7.10 | e2e + eval | R2 |
| FR-SRC-1 BOM sourced with supplier lineage | wf 03 | integration | R3 |
| FR-PROM-1 Promise hit ≥ 95% | NFR-5 | ops metric | R3 |
| FR-LIVE-1 Viewer completes 10 live actions without leaving | spec §9.10 | e2e `live.spec.ts` | R4 |
| FR-LIVE-2 Product focus fan-out ≤ 400 ms | NFR-3 | load | R4 |
| FR-MEDIA-1 Replay card follows scrub position | wf 07 | e2e | R5 |

## Release process

1. Feature flags for every surface (Vercel Flags or LaunchDarkly). Dark-launch to staff first.
2. Release candidate cut from `main`, then staging soak of 48 h with synthetic orders running every hour.
3. Go/no-go checklist (G5): SLO dashboards, runbooks, on-call, rollback tested, support macros, legal copy.
4. Staged rollout: 5% → 25% → 100%, with automated rollback on error-budget burn.
5. Launch comms: changelog, waitlist email, and from R4 on, a launch livestream on DiscoverMake Live.

## Operations

| Area | SLO / KPI | Owner |
|---|---|---|
| Quote engine | p95 latency ≤ 4 s; accuracy ±8% | Eng |
| Checkout | 99.9% availability; payment error rate < 0.5% | Eng |
| Promise | ≥ 95% on-time | Mfg ops |
| Shops | Accept within 2 business hours ≥ 90%; first-pass yield ≥ 97% | Mfg ops |
| Live | Join time ≤ 2 s; event fan-out p95 ≤ 400 ms | Eng |
| Support | First response ≤ 2 h (business), CSAT ≥ 4.6 | Support |

**Runbooks** (`docs/runbooks/`):
- payment webhook backlog
- shop declines spike
- quote drift alert
- carrier outage
- live ingest failure
- moderation incident
- data deletion request
- secret rotation

**Weekly rituals:**
- quote-vs-invoice calibration
- Promise miss review (by leg)
- shop scorecards
- top support issues → backlog
