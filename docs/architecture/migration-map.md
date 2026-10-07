# Migration map: what moves from each DiscoverMake repo

**Decision (owner, 2026-10-06):** `Greenmamba29/discovermake` is the single V1 codebase. The Make.com product is retired. Everything useful in the three DiscoverMake repos is migrated into it. Commodity capability comes from open-source projects (`docs/product/DISCOVERMAKE_MVP_SCORECARD_OPEN_SOURCE_ACCIO.md` §6–§11).

Pre-pivot code stays in git history. The last commit before the R1 rebuild is **`00b8e00`** on `claude/discovermake-live-architecture-5kvns2`. Restore any file with:

```
git show 00b8e00:<path>
```

## `Greenmamba29/discovermake` (base repo)

| Asset | Path at `00b8e00` | Destination | Release |
|---|---|---|---|
| App shell, Tailwind, UI primitives, motion components | `src/app/layout.tsx`, `src/components/ui/*`, `src/components/motion/*` | Kept in place, restyled to the V1 system | R1 |
| Stripe SDK usage, verified webhook pattern | `src/app/api/webhooks/stripe`, `src/app/api/checkout` | Rebuilt as `src/server/payments` + `/api/webhooks/stripe` (server-priced, idempotent) | R1 |
| Stripe Connect onboarding | `src/app/api/payouts/connect/route.ts` | **Done (2026-10-06).** `src/server/shops/connect.ts`; routes `POST /api/shop/payouts/connect`, `GET /api/shop/payouts/status`, `POST /api/admin/shops/:shopId/connect`, `POST /api/webhooks/stripe-connect`; UI `src/components/shop/payouts-card.tsx` (on `/shop/jobs`) and `src/app/(console)/shop/payouts/page.tsx`; contract `src/contracts/connect.ts`; tests `tests/shop/connect.test.ts`. Ledger routes payouts to Connect only when `shops.stripe_payouts_enabled` (migration `0002_connect_payouts_enabled`) | R1 |
| reactflow graph visualizer | `src/components/visualizer.tsx`, `src/components/blueprint-visualization.tsx` | **Done (2026-10-06), R1 order page.** Mapping `src/lib/build-graph.ts` (pure, from `OrderView`); canvas `src/components/build-graph/GraphView.tsx` (@xyflow/react v12); panel `src/components/build-graph/BuildGraphPanel.tsx` on `src/app/(app)/orders/[orderId]/page.tsx` (Build → Part → Material → Process → Shop → QA → Shipment → Passport); tests `src/lib/build-graph.test.ts`, `src/components/build-graph/build-graph-panel.test.tsx` | R1 (order page) → R2 (Workspace Graph View) |
| Branched multi-step onboarding | `src/app/onboarding/page.tsx` | 4-step onboarding (workflow 10) | R2 |
| Publish wizard, earnings page | `src/app/maker/publish`, `src/app/maker/earnings` | Creator Studio publishing and revenue | R4 |
| Revenue charts (recharts) | `src/app/admin/revenue` | Creator and ops dashboards | R4 |
| Audit log pattern | `src/lib/admin.ts` | Superseded by `domain_events` | — |
| Playwright setup | `playwright.config` | E2E suite | R1 |
| **Not migrated** | Template catalog, `src/data/templates_clean` (32 MB), `templates-db`, Make.com scrapers, `connect/[...slug]` SEO pages, bounties, gigs, matching, Firebase Auth/Firestore, `webhooks/make-sync` | Retired: different product or insecure | — |

## `Greenmamba29/discovermake-2.0`

This repo is an earlier subset of the base repo. Only two things are new relative to it:

| Asset | Path | Destination | Release |
|---|---|---|---|
| Streaming AI chat route (AI SDK `streamText` + `useChat`, Markdown + JSON blueprint) | `src/app/api/architect/route.ts`, `src/app/architect/page.tsx` | **Done (2026-10-06): Make AI intake**, re-prompted for physical products. Returns a zod-validated `CreationIntent` (`src/contracts/make-ai.ts`) via AI SDK v7 structured output on Gemini instead of a Make.com blueprint. Server `src/server/make-ai/`, route `POST /api/make-ai/intake` (behind `MAKE_AI_ENABLED`, per-IP + instance rate limit), page `/make/ai` (`src/app/make/ai/page.tsx`, behind `NEXT_PUBLIC_MAKE_AI_ENABLED`; `/make` stays the DXF upload page), UI `src/components/make-ai/`, tests `tests/make-ai/` | R2 seed (ported after R1) |
| AI SDK + Gemini integration notes | `.agent/skills/google_integrations.md` | `docs/agent-notes/ai-sdk-gemini.md` | Now |
| **Not migrated** | `src/lib/stripe.ts` (superseded) · `api/checkout/create-payment-intent` (trusts a client price) · `make-creds.json` (**committed Make.com session secret: rotate, then delete the file and purge it from history**) · Make.com scripts and templates | — | — |

Once the secret is rotated, archive `discovermake-2.0` on GitHub (Settings → Archive) so nobody builds on it.

## `Greenmamba29/jobsdiscovermake`

| Asset | Destination | Notes |
|---|---|---|
| BLS Occupational Outlook data (public domain) | `data/workforce/make-network-occupations.csv`: the 24 occupations relevant to shops, creators and logistics | For shop recruitment, labor-rate sanity checks and Campus Makers content |
| Scrape → parse → LLM-rubric scoring → treemap pipeline | **Not copied.** It is a fork of `karpathy/jobs` with no license, so the code is all-rights-reserved. If we need the pattern (e.g. scoring supplier or material pages), write our own small script | — |

## Accio

The owner holds the **Accio Work** account the agents will use. The R2 bridge is built (`POST /api/mcp/sourcing`, see `docs/architecture/r2-implementation.md`). To connect it:
1. Create an Accio client in `/admin/sourcing` → Accio clients. Copy the one-time `dmsc_…` token.
2. Register `${APP_URL}/api/mcp/sourcing` as an MCP server in Accio Work, using that bearer token.
3. Create the agent group from `mcp/discovermake-sourcing/accio-agent-group.md`, and schedule the Procurement Lead to poll `discovermake.sourcing.next_job` every 15 minutes.

See workflow 03 and ADR-0005.
