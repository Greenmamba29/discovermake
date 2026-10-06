# 11 · Platform, data + security

## Immediate actions (do these before any new feature work)

These findings come from the repo audit on 2026-10-06. Details are in `docs/architecture/current-state.md`.

| # | Action | Repo | Severity |
|---|---|---|---|
| 1 | **Rotate the Make.com session behind `make-creds.json`** (it is committed: a `Cookie` and an `x-xsrf-token`). Log that session out. Remove the file and add it to `.gitignore`. Purge it from history with `git filter-repo`, which is a force-push, so coordinate first. | discovermake-2.0 | Critical |
| 2 | **Rotate the Stripe live key** that `EPIC_V3.md` says was used in development (it is stored in local `.env.local` / `mcp_config.json`, not in git). | discovermake | High |
| 3 | Lock down `POST /api/webhooks/make-sync`. It is unauthenticated, shells out to `bun`, and POSTs to a caller-supplied URL (SSRF). Remove it or add an HMAC check and an allowlist. | both | High |
| 4 | `GET /api/download` takes the user's UID as its access token. Replace that with signed, expiring URLs checked server-side. | both | High |
| 5 | The 2.0 `create-payment-intent` route trusts a client-supplied amount. Do not port it, and price only on the server. | discovermake-2.0 | High |
| 6 | 2.0 `/admin` has no guard. Add server-side role checks for every admin route. | discovermake-2.0 | Medium |
| 7 | The Stripe webhook writes with the Firestore client SDK. Use the Admin SDK (or Postgres after the migration). | discovermake | Medium |

## Target stack

| Layer | Choice | Notes |
|---|---|---|
| Web app | **Next.js (App Router), React 19, TypeScript** | Keep the existing app as the base (`discovermake`) |
| UI | Tailwind + shadcn-style primitives → `packages/design-system` | Keep the existing `src/components/ui` |
| 3D | three.js + react-three-fiber | Workspace, configure, live model |
| Database | **Postgres** (Supabase or Neon) | Build Graph node/edge tables, orders, quotes, ledger. ADR-0006 |
| Auth | Supabase Auth (or Clerk) with passkeys and orgs | Migrates from Firebase Auth. Roles: buyer, creator, shop, ops, admin |
| Files | S3-compatible object storage + signed URLs | CAD, images, QA photos, recordings |
| Workflows | **Temporal** (Cloud to start) | Order, sourcing, dispatch, shipment, drop workflows |
| Events | Transactional outbox → event bus (Postgres LISTEN/NOTIFY to start; NATS/Kafka later) | ADR-0002 |
| Commerce | Stripe (Payments, Connect, Tax) + Medusa modules where they help (cart, pricing, promotions) | ADR-0004 |
| AI (UI streaming) | Vercel AI SDK, multi-provider | Gemini already wired |
| Agents service | `openai/openai-agents-python` (MAKE Agent + specialists), evals per agent | Python service next to the CAD worker |
| Accio bridge | `modelcontextprotocol/typescript-sdk` remote MCP server (`services/accio-bridge`) | ADR-0005 |
| Client UI state | Zustand (UI only, never manufacturing truth) | |
| Graph UI | xyflow (React Flow) | Already a dependency as `reactflow` |
| Text → CAD | `earthtojake/text-to-cad` + CadQuery; FreeCAD for validation/export (isolated, LGPL) | |
| CAD / geometry | Python workers: CadQuery, ezdxf, OpenCascade | Sandboxed, no network |
| Search | Meilisearch (catalog, builds), Qdrant (multimodal, R5+) | |
| Routing / optimization | Google OR-Tools | Dispatch, batching, sourcing |
| Live | LiveKit (Cloud → self-host option), MediaMTX, optional Owncast | ADR-0003 |
| Policy | OPA for production authorization and export rules | Spec §29 guardrail |
| Observability | OpenTelemetry → Grafana/Datadog, Sentry, PostHog | |
| Hosting | Vercel (web) + container platform (Fly/Render/ECS) for workers, MediaMTX, Temporal workers | `templates-db` file reads and `bun` exec will not run on Vercel. Remove them |

## Monorepo migration (incremental, spec §20)

1. Convert `discovermake` to a workspace (pnpm or bun workspaces + Turborepo). Move the current app to `apps/web` without changing behavior.
2. Add these packages:
   - `packages/contracts` (zod schemas)
   - `packages/design-system`
   - `packages/build-graph`
   - `packages/live-protocol`
   - `packages/commerce`
   - `packages/events`
3. Add `surfaces/` (make, live, build-workspace, creator-studio, ordering, my-builds), `agents/`, and `mcp/discovermake-sourcing/`, following scorecard §21.
4. Add these services: `quote-engine`, `cad-worker` (Python), `sourcing`, `live-gateway`, `manufacturing-router`. Add `workflows/` (Temporal) as code next to these planning docs, in `apps/worker`.
5. Add `services/accio-bridge` (MCP).
6. Enforce the dependency rule (spec §27) with lint boundaries (`eslint-plugin-boundaries`). A surface must not import another surface's internals.

## Data migration: Firestore → Postgres (ADR-0006)

- Keep Firebase Auth working during the migration. Map Firebase UIDs to new user IDs in an `identities` table.
- Run a one-time export of `users`, `purchases`, `reviews` and `projects`. Archive template-marketplace-only collections (`gigs`, `bounties`, `blueprints`) unless the G0 brand decision keeps that product.
- Dual-read for one release, then cut over.

## Security architecture

- **AuthN/Z:** server-side session checks on every route handler, plus row-level security in Postgres keyed by `org_id` / `owner_id`.
- **Uploads:** signed URLs, type and size validation, AV scan, a sandboxed parser, and private by default.
- **Payments:** the server prices everything; webhooks are verified and idempotent; no card data touches our servers.
- **Shop job packets:** signed, expiring, watermarked, and access-logged.
- **Live:** short-lived LiveKit tokens with scoped grants; ingest keys per source, rotated; moderation.
- **AI:** prompt-injection defenses on uploaded text and URLs; tool calls restricted per agent; and no LLM path to machines. The path is always LLM → structured plan → deterministic validation → OPA policy → human approval → signed job.
- **Compliance:** export-control screening (EAR/ITAR keywords and geometry classes) with a human review queue; a prohibited-items policy; GDPR/CCPA data rights; and SOC 2-ready audit logging from day one.
- **Secrets:** a secret manager such as Doppler, 1Password or Vercel encrypted env. Pre-commit `gitleaks`. CI secret scanning.
- **Copyleft:** any GPL/LGPL tooling (FreeCAD SheetMetal, etc.) runs as an isolated service and is recorded in a license ledger before use.

## Environments

`local` (docker-compose: Postgres, Temporal dev, MediaMTX, LiveKit dev, Meilisearch) → `preview` (per PR) → `staging` (Stripe test, sandbox shop adapter) → `production`.
