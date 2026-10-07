# Target state

DiscoverMake is the **On-Demand Creation Operating System** and the **live network for things being made**. Tagline: *Discover. Make. Build.*

```
DISCOVERMAKE = CREATION ENGINE (Make AI + MAKE Compiler + MAKE Network)
             + LIVE COMMERCE NETWORK (LiveKit + MediaMTX + Live Build Protocol)
             + PRIME LAYER (Accio-backed sourcing + Delivery Promise)
```

## System map

```
                         ┌────────────────────── CLIENTS ───────────────────────┐
                         │ Web (Next.js) · iOS/Android (Expo) · Shop Console    │
                         │ Creator Studio · Ops/Admin                            │
                         └───────────────┬──────────────────────┬───────────────┘
                                         │ HTTPS / SSE          │ WebRTC + data tracks
                    ┌────────────────────▼──────────┐   ┌───────▼─────────────────────┐
                    │ apps/web (route handlers, RSC) │   │ LiveKit  ◀── MediaMTX ingest │
                    └───┬───────────┬───────────┬───┘   └───────┬─────────────────────┘
                        │           │           │               │
         ┌──────────────▼┐ ┌────────▼───────┐ ┌─▼────────────┐ ┌▼──────────────┐
         │ make-         │ │ quote-engine   │ │ commerce     │ │ live-gateway  │
         │ orchestrator  │ │ (+cad-worker,  │ │ (Stripe,     │ │ (Live Build   │
         │ (Make AI      │ │  DFM, pricing) │ │  Medusa mods,│ │  Protocol)    │
         │  agents)      │ └────────┬───────┘ │  ledger)     │ └──────┬────────┘
         └──────┬────────┘          │         └──────┬───────┘        │
                │         ┌─────────▼─────────┐      │                │
                │         │ sourcing (Accio + │      │                │
                │         │ providers, Promise)│     │                │
                │         └─────────┬─────────┘      │                │
                │         ┌─────────▼──────────┐     │                │
                │         │ manufacturing-     │     │                │
                │         │ router (dispatch,  │     │                │
                │         │ shop adapters)     │     │                │
                │         └─────────┬──────────┘     │                │
         ┌──────▼───────────────────▼────────────────▼────────────────▼──────┐
         │ Postgres: Build Graph · catalog · quotes · orders · ledger · live │
         │ Outbox → event bus · Temporal (order/sourcing/dispatch/ship/drop) │
         │ Object storage (CAD, media, QA) · Meilisearch · Qdrant (later)    │
         └───────────────────────────────────────────────────────────────────┘
                                     │
                         Partner shops · suppliers · carriers
```

## Sources of truth (spec §18)

| Domain | Truth for | Store |
|---|---|---|
| Build Graph | What the product is | Postgres node/edge tables (ADR-0001) |
| Temporal | What is happening to it | Workflow history |
| Commerce / Orders | What was bought and paid for | Postgres + Stripe |
| Live Build Protocol | What a live session is presenting | live-gateway event log |
| Product Passport | What was ultimately manufactured | Signed snapshot |

## Surfaces → shared objects

| Surface | Reads | Writes | Emits |
|---|---|---|---|
| MAKE | Build, Requirement, DesignVersion | Build, Requirement, CADArtifact, MaterialCandidate | build.created, requirements.generated, design.generated |
| BUILD WORKSPACE | Build Graph, Quote | DesignVersion, MaterialSpec, ProcessPlan | design.updated, design.approved, material.selected |
| ORDERING | Quote, SupplierOffer | Order, Payment | quote.approved, supplier.selected, order.created, payment.completed |
| CREATOR STUDIO | Build, LiveSession, ledger | Product, publish flags, Show | build.published, live.started, product.featured |
| LIVE | LiveSession, Build, BuildSlot | BuildSlot, Remix Build | product.focus, remix.created, build_slot.claimed |
| MY BUILDS | Order, ManufacturingJob, Shipment, Passport | — | — |

## Guardrail (spec §29)

`LLM → structured Build Plan → deterministic validation (DFM, schema) → OPA policy → human approval → signed manufacturing job → shop/machine adapter → inspection`

No LLM output ever reaches a machine directly.

See `workflows/` for the delivery plan and `docs/adr/` for the decisions.
