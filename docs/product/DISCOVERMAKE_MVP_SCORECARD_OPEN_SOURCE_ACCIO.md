# DiscoverMake MVP — Competitive Scorecard, Open-Source Stack, and Accio Work / Alibaba Background Architecture

**Date:** 2026-10-06  
**Purpose:** Implementation handoff for the DiscoverMake MVP.  
**North Star:** **Watch → Want → Configure → Quote → Make → Track → Receive → Share → Remix**

---

## 1. Executive conclusion

DiscoverMake should **not** try to beat Xometry, Fictiv, MakerVerse, Protolabs, Dough, Desmake, Alibaba, and QVC at each of their strongest individual functions on day one.

It should become the **orchestration layer that combines their category strengths into one persistent Build object**:

**Idea → specification → CAD → materials → DFM → sourcing → binding quote → order → live media → remix → production → QA → delivery → Product Passport.**

The differentiator is not another AI chat interface. It is the combination of:

1. **Build Graph** — persistent digital DNA of a physical product.
2. **MAKE Compiler** — turns intent into a validated manufacturing plan.
3. **Materials + Makeability intelligence** — deterministic engineering support around model reasoning.
4. **Accio Work / Alibaba sourcing sidecar** — supplier discovery, negotiation, RFQ, logistics, order-management support.
5. **Live commerce + manufacturing media** — LiveKit + Owncast, later MediaMTX.
6. **Creator/remix economics** — products can be forked, customized, sold, and produced on demand.
7. **Build-capacity commerce** — sell production slots rather than speculative inventory.
8. **Product Passport** — persistent record of what was actually manufactured.

The current DiscoverMake MVP is **not yet at that finish line**. It already has discovery, saved designs, creation inputs, persistent projects/uploads, manufacturing briefs, and quote-readiness tracking. The missing critical path is AI/CAD, supplier quotes, payments, and manufacturing integration.

---

# 2. Competitive scorecard

### Scoring method

- **1 = weak / not a primary capability**
- **3 = credible**
- **5 = category-leading**
- Scores are a **strategy assessment based on public product evidence**, not an audited technical benchmark.
- **DiscoverMake Target V1** is a target architecture score, not a statement about current deployed capability.

| Capability | Weight | Xometry | Fictiv | MakerVerse | Protolabs | Dough | Desmake | DiscoverMake Current | DiscoverMake Target V1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Idea → structured product spec | 8 | 2 | 2 | 1 | 1 | 5 | 4 | 3 | **5** |
| CAD / DFM | 10 | **5** | **5** | **5** | **5** | 3 | 2 | 1 | **4** |
| Materials intelligence | 7 | 4 | **5** | 4 | 4 | 3 | 2 | 2 | **5** |
| Binding / orderable quoting | 10 | **5** | 4 | **5** | **5** | 2 | 3 | 1 | **4** |
| Supplier / manufacturing network | 10 | **5** | **5** | 4 | **5** | 3 | 4 | 1 | **4** |
| Procurement automation | 8 | 4 | 4 | 3 | 2 | 4 | 4 | 1 | **5** |
| Order / production tracking | 8 | **5** | 4 | 4 | 4 | 4 | **5** | 2 | **5** |
| Quality / compliance | 8 | **5** | **5** | **5** | **5** | 2 | 3 | 1 | **4** |
| Live commerce / media | 10 | 1 | 1 | 1 | 1 | 2 | 2 | 1 | **5** |
| Remix / creator on-demand model | 7 | 1 | 1 | 1 | 1 | 4 | **5** | 2 | **5** |
| Robotics / factory media | 6 | 1 | 1 | 1 | 1 | 1 | 2 | 1 | **4** |
| Agent / API extensibility | 4 | 3 | 3 | 3 | 2 | 3 | **5** | 1 | **5** |
| Product Passport / provenance | 4 | 3 | 3 | 3 | 2 | 2 | 4 | 1 | **5** |
| **Weighted strategic score /100** | **100** | **71** | **68** | **64** | **63** | **59** | **67** | **28** | **91 target** |

### What this means

**Xometry / Fictiv / MakerVerse / Protolabs** currently own the hardest trust layer: orderable manufacturing, DFM, quality, supplier capacity, and enterprise confidence.

**Dough** is strategically important because it attacks the prompt-to-physical-product founder workflow.

**Desmake** is the closest creator/on-demand architecture threat because it already treats design as a publishable object and routes production after the sale.

**DiscoverMake's opportunity** is to combine manufacturing execution with live media, remixing, creator economics, and Build Graph persistence. That combination is the opening.

---

# 3. Competitive feedback: what DiscoverMake must do better

## 3.1 Do not fake the quote

A model-generated cost estimate is not a manufacturing quote.

Every price shown must be visibly labeled as one of:

- **AI estimate**
- **supplier estimate**
- **supplier-confirmed quote**
- **binding quote**

The MVP should graduate users toward binding supplier pricing as quickly as possible.

## 3.2 Make trust visible

Use explicit states:

**CONCEPT → ENGINEERING REVIEW → MANUFACTURING READY → SUPPLIER CONFIRMED → ORDERABLE**

Never make an AI concept look production-ready when it is not.

## 3.3 Do not rebuild Alibaba

Alibaba/Accio already provides supplier discovery, communication, negotiation, trade data, and logistics workflows.

DiscoverMake should own the **manufacturing requirements object** and route it to Accio Work.

Accio should return structured supplier evidence into the Build Graph.

## 3.4 The media layer is a core business, not marketing

DiscoverMake's strongest differentiated loop is:

**Manufacturing creates media → media creates demand → demand triggers manufacturing.**

Live factories, creator demos, robot cells, public build milestones, limited production drops, and live remixing belong in the product architecture.

## 3.5 Sell build capacity

Do not require creators to stock 500 finished units.

Allow them to launch one validated prototype and sell:

- 50 prototype slots
- 250 small-batch slots
- 1,000 production slots

Once thresholds are reached, the production workflow is triggered.

## 3.6 Narrow manufacturing first

V1 should prove a limited set of repeatable categories:

- CNC-machined parts
- laser/sheet parts
- additive/3D printed parts
- simple wood products
- simple sewn/textile products
- packaging
- basic electronics assemblies via external suppliers
- simple multi-part consumer assemblies

Do not claim autonomous production of arbitrary yachts, submarines, aircraft, or regulated products in V1.

The platform architecture can support those classes later with professional review and certified suppliers.

---

# 4. Five connected V1 surfaces

## 4.1 MAKE

**Purpose:** Convert intent into a persistent Build.

Inputs:

- text
- voice
- image
- sketch
- CAD
- URL
- reference product
- BOM
- measurements

Outputs:

- structured requirements
- unknowns
- parts / assemblies
- material candidates
- initial CAD
- BOM
- process plan
- Makeability score
- preliminary cost range
- Build record

## 4.2 BUILD WORKSPACE

**Purpose:** Canonical editor for one Build.

Sections:

- Overview
- Design
- Parts
- Materials
- Process
- Source
- Quotes
- Production
- QA
- Delivery
- Passport

The product object is the center. AI is contextual support.

## 4.3 ON-DEMAND ORDERING

Required six-screen flow:

1. **Configure Order**
2. **Instant Quote**
3. **Manufacturing Route**
4. **Approval + Checkout**
5. **Production Run / Build Slot**
6. **Order Tracking / Product Passport**

Canonical flow:

**Configure → Quote → Route → Approve → Build → Track**

## 4.4 CREATOR STUDIO

**Purpose:** Publish Builds, manage product rights/remix settings, schedule live shows, launch drops, see sales and royalties.

Core functions:

- publish Build
- price product
- remix permissions
- royalty rules
- schedule show
- product queue
- live controls
- build-slot drop
- replay / clip manager
- audience / conversion analytics

## 4.5 LIVE

**Purpose:** Watch products being invented, demonstrated, manufactured, and sold.

Core actions:

- **BUY**
- **MAKE THIS**
- **REMIX**
- **ASK CREATOR**
- **ASK MAKE AI**
- **CLAIM BUILD SLOT**

LiveKit handles interactive realtime rooms.

Owncast handles broadcast/channel behavior.

DiscoverMake owns the **Live Build Protocol** connecting video moments to Build Graph state.

## 4.6 MY BUILDS / ORDERS

**Purpose:** One persistent home for everything created, remixed, ordered, manufactured, and delivered.

Production timeline:

**Design locked → Material sourced → Production → QA → Assembly → Packaging → Shipping → Delivered → Passport**

---

# 5. Canonical architecture

```text
                              DISCOVERMAKE

    ┌──────────┬───────────┬──────────────┬──────────┬───────────────┐
    │   MAKE   │   LIVE    │ BUILD SPACE  │ STUDIO   │ MY BUILDS     │
    └────┬─────┴─────┬─────┴──────┬───────┴────┬─────┴──────┬────────┘
         │           │            │            │            │
         └───────────┴────────────┼────────────┴────────────┘
                                  ▼
                             BUILD GRAPH
                                  │
         ┌────────────────────────┼──────────────────────────┐
         ▼                        ▼                          ▼
     MAKE Compiler             Commerce                 Live Protocol
         │                        │                          │
         ▼                        ▼                          ▼
 CAD / Materials / DFM      Quote / Order              LiveKit/Owncast
         │                        │
         └──────────┬─────────────┘
                    ▼
                SOURCING JOB
                    │
                    ▼
          DISCOVERMAKE MCP SERVER
                    │
                    ▼
               ACCIO WORK
                    │
      Alibaba / 1688 / suppliers / email
                    │
                    ▼
           STRUCTURED SUPPLIER OFFERS
                    │
                    ▼
                 BUILD GRAPH
                    │
                    ▼
        APPROVAL → ORDER → PRODUCTION
```

---

# 6. The open-source GitHub stack

GitHub star counts below were checked on **2026-10-06** and will change over time.

## Tier A — install / integrate for V1

| Repository | Approx. stars | Role | Integration decision |
|---|---:|---|---|
| `vercel/turborepo` | 31.2K | TypeScript monorepo | **Use** for repo organization |
| `shadcn-ui/ui` | 125K | UI primitives | **Use** for shared design system |
| `pmndrs/zustand` | 58.8K | client UI state | **Use**, but never as manufacturing source of truth |
| `supabase/supabase` | 111K | Postgres/Auth/Storage/Realtime | **Core V1 data platform** |
| `temporalio/temporal` | 23.5K | durable workflows | **Core manufacturing/order state runtime** |
| `openai/openai-agents-python` | 29.9K | multi-agent orchestration | **MAKE Agent service** |
| `modelcontextprotocol/typescript-sdk` | 13.5K | MCP server/client | **Accio Work bridge** |
| `open-policy-agent/opa` | 12.3K | deterministic policy | **Safety / production / approval gates** |
| `google/or-tools` | 14.2K | optimization/routing | **Supplier/factory route optimization** |
| `medusajs/medusa` | 36.6K | composable commerce | **Cart/order/payment/fulfillment primitives**; verify current module licensing |
| `livekit/livekit` | 21.3K | realtime rooms/video/data | **Core DiscoverMake Live interaction layer** |
| `owncast/owncast` | 11.6K | self-hosted streaming + chat | **Broadcast/channel layer** |
| `mrdoob/three.js` | 116K | browser 3D rendering | **Object viewer foundation** |
| `pmndrs/react-three-fiber` | 32.8K | React renderer for Three.js | **Build Workspace 3D UI** |
| `xyflow/xyflow` | 38.6K | node/graph UI | **Build Graph visualizer** |
| `earthtojake/text-to-cad` | 17.7K | agent-to-CAD workflows | **Natural-language CAD worker** |
| `CadQuery/cadquery` | 5.9K | parametric CAD | **Headless parametric geometry worker** |
| `FreeCAD/FreeCAD` | 34K | full parametric CAD | **CAD validation/export worker** |
| `meilisearch/meilisearch` | 59.5K | catalog/hybrid search | **Discover + materials + suppliers + products search**; verify current repo licensing |

### Important architecture rule

Do **not** copy all of these codebases into the web app.

Use services/workers:

```text
web
  → api
  → build-graph
  → temporal workflows
  → agent service
  → cad worker
  → sourcing bridge
  → commerce
  → live gateway
```

---

# 7. Tier B — reconstruction / V1.5

| Repository | Approx. stars | Role | Decision |
|---|---:|---|---|
| `opencv/opencv` | 91.1K | vision / measurements / inspection | Add for reconstruction + QA |
| `facebookresearch/sam2` | 20K | image/video segmentation | Separate subject/components from references |
| `isl-org/Open3D` | 14K | point clouds / mesh processing | Reconstruction worker |
| `colmap/colmap` | 12.9K | photogrammetry / SfM / MVS | Multi-view reconstruction |
| `qdrant/qdrant` | 34.9K | vector similarity | Similar Build/part/material retrieval; defer until needed |

Reconstruction pipeline:

```text
Photos / video / scan
        ↓
      SAM 2
        ↓
      OpenCV
        ↓
   COLMAP / Open3D
        ↓
 reconstructed mesh
        ↓
 parametric reinterpretation
        ↓
 text-to-cad / CadQuery
        ↓
 manufacturing CAD
        ↓
 human dimension confirmation
```

A mesh is **not** manufacturing CAD. Critical dimensions must remain unknown until validated.

---

# 8. Tier C — media/factory ingest / V1.5

| Repository | Approx. stars | Role | Decision |
|---|---:|---|---|
| `bluenviron/mediamtx` | 20.3K | RTMP/SRT/RTSP/WebRTC/LL-HLS ingest/proxy | Add when factory/robot camera sources expand |

Flow:

```text
Phone / OBS / RTSP / SRT / robot camera
                    ↓
                 MediaMTX
                    ↓
                 LiveKit
                    ↓
          DiscoverMake Live session
```

Owncast remains the creator/channel/broadcast layer.

---

# 9. Tier D — robotics / Phase 2

| Repository | Approx. stars | Role | Decision |
|---|---:|---|---|
| `huggingface/lerobot` | 28K | learned robot policies / datasets | robotics AI layer |
| `google-deepmind/mujoco` | 15.5K | physics simulation | simulation before execution |
| `ros2/ros2` | 6.1K | robot middleware | machine/robot communications |

Correct safety architecture:

```text
LLM proposal
   ↓
structured operation plan
   ↓
engineering validation
   ↓
OPA policy
   ↓
MuJoCo / simulation
   ↓
human / facility approval
   ↓
signed machine job
   ↓
ROS / robot execution
   ↓
vision inspection
```

Never use:

```text
LLM → robot / CNC directly
```

---

# 10. Tier E — machine/additive adapters / Phase 2+

| Repository | Approx. stars | License concern | Role |
|---|---:|---|---|
| `prusa3d/PrusaSlicer` | 9.4K | AGPL-3.0 | additive slicing worker; isolate |
| `Klipper3d/klipper` | 11.9K | GPL-3.0 | printer firmware adapter |
| `MarlinFirmware/Marlin` | 17.6K | GPL-3.0 | printer firmware adapter |
| `grbl/grbl` | 6.3K | verify | CNC/G-code controller adapter |

Do not make these codebases part of proprietary core logic. Treat them as external adapters/services and complete licensing review first.

---

# 11. Optional enterprise adapters — do not make core

| Repository | Approx. stars | Role |
|---|---:|---|
| `frappe/erpnext` | 39.8K | ERP / manufacturing / procurement integration target |
| `odoo/odoo` | 54.9K | ERP / inventory / manufacturing integration target |

DiscoverMake should expose an ERP adapter interface rather than become an ERP.

---

# 12. Components DiscoverMake must own

Do **not** outsource these to open source because they are the core moat.

1. **Build Graph ontology**
2. **MAKE Compiler**
3. **Makeability Engine**
4. **Materials Intelligence Graph**
5. **Cross-process DFM rule library**
6. **Quote normalization and confidence system**
7. **Supplier Performance Graph**
8. **Machine Capability Graph**
9. **Manufacturing routing objective function**
10. **Live Build Protocol**
11. **Build-slot commerce logic**
12. **Creator/remix lineage and royalty rules**
13. **Reconstruction Confidence Engine**
14. **Product Passport schema**
15. **Production evidence / audit trail**

---

# 13. Accio Work + Alibaba background architecture

## Critical fact

Do **not** design DiscoverMake around calling a private Accio agent endpoint.

Current Accio Work documentation states it does **not** expose an inbound Agent API/webhook/deep-link endpoint. Accio does, however, support:

- Alibaba.com connector
- Gmail and other connectors
- browser operation
- automated supplier email follow-up
- scheduled/cron-like tasks
- custom skills
- MCP servers
- multi-agent groups
- Alibaba-integrated Sourcing Expert

Therefore the correct architecture is to **invert control**:

> DiscoverMake exposes sourcing tools to Accio Work through MCP. Accio Work runs in the background and calls DiscoverMake.

---

# 14. DiscoverMake Sourcing MCP Server

Build a small service:

```text
services/accio-bridge/
```

Use:

`modelcontextprotocol/typescript-sdk`

Expose these tools:

```text
discovermake.sourcing.next_job

discovermake.sourcing.get_job

discovermake.sourcing.get_attachments

discovermake.sourcing.submit_supplier

discovermake.sourcing.submit_offer

discovermake.sourcing.update_negotiation

discovermake.sourcing.attach_document

discovermake.sourcing.request_approval

discovermake.sourcing.complete_job
```

---

# 15. SourcingRequest contract

```json
{
  "sourcing_request_id": "SRC-20482",
  "build_id": "DM-10482",
  "design_version": 7,
  "part_id": "PART-009",
  "name": "CNC aluminum lamp arm",
  "quantity": 250,
  "target_unit_cost_usd": 18,
  "material": "6061-T6 aluminum",
  "process": ["CNC milling", "anodizing"],
  "dimensions_mm": {},
  "critical_tolerances": [],
  "surface_finish": "matte black anodize",
  "required_certifications": [],
  "target_regions": ["US", "China", "Vietnam"],
  "target_delivery_date": null,
  "acceptable_substitutions": [],
  "attachments": [
    "STEP",
    "2D drawing",
    "BOM",
    "inspection requirements"
  ],
  "approval_policy": {
    "allow_supplier_contact": true,
    "allow_negotiation": true,
    "allow_sample_request": false,
    "allow_purchase": false
  }
}
```

---

# 16. Accio background agent group

Inside Accio Work create an **Agent Group**:

### Team Lead — DiscoverMake Procurement Lead

Owns job orchestration and reports back to DiscoverMake.

### Supplier Discovery Agent

Uses Alibaba/Accio sourcing to identify qualified candidates.

### RFQ Agent

Creates and sends RFQs with the approved technical package.

### Negotiation Agent

Negotiates price, MOQ, lead time, tooling, samples, shipping terms, and packaging.

### Supplier Verification Agent

Checks:

- Verified Supplier status
- company identity
- production capability
- stated certifications
- relevant process capability
- MOQ
- lead time
- location
- available evidence

### Quote Normalization Agent

Converts heterogeneous supplier responses into the canonical `SupplierOffer` schema.

### Logistics Agent

Uses Alibaba logistics / shipping information when appropriate.

---

# 17. SupplierOffer contract

```json
{
  "supplier_offer_id": "OFF-88214",
  "sourcing_request_id": "SRC-20482",
  "supplier": {
    "name": "Example Precision Ltd.",
    "platform": "Alibaba",
    "verified": true,
    "country": "CN"
  },
  "quantity": 250,
  "unit_price_usd": 16.8,
  "tooling_usd": 0,
  "sample_cost_usd": 95,
  "moq": 100,
  "production_lead_days": 16,
  "shipping_lead_days": 8,
  "incoterm": "DDP",
  "processes": ["CNC milling", "anodizing"],
  "certifications_claimed": [],
  "exceptions": [],
  "attachments": [],
  "source_evidence": [],
  "confidence": 0.86,
  "negotiation_status": "supplier-confirmed",
  "valid_until": null
}
```

---

# 18. Background sourcing workflow

```text
Build reaches SOURCE stage
        ↓
DiscoverMake creates SourcingRequest
        ↓
Postgres: sourcing_jobs = QUEUED
        ↓
Accio Work scheduled task calls MCP next_job
        ↓
Accio Sourcing Expert + Alibaba connector
        ↓
Supplier discovery
        ↓
RFQs / inquiries
        ↓
Automated follow-up
        ↓
Negotiation
        ↓
Normalized SupplierOffer records
        ↓
MCP submit_offer
        ↓
DiscoverMake Quote Engine
        ↓
OR-Tools route comparison
        ↓
User sees Quote / Manufacturing Route
        ↓
Human approval
        ↓
Purchase / payment / sample action
```

---

# 19. Approval policy

For V1:

### Accio may do autonomously

- search suppliers
- compare suppliers
- collect public evidence
- create draft RFQs
- send approved RFQs
- follow up
- negotiate within defined bounds
- organize quotes
- request clarifications
- update sourcing records

### Human approval required

- release confidential full design package to an unapproved supplier
- pay deposits
- place a purchase order
- accept material substitutions affecting engineering requirements
- accept changed tolerances
- approve tooling expense
- approve production
- change safety/compliance requirements

This protects the Build Graph from procurement decisions silently changing the engineering definition.

---

# 20. Quote Engine

The DiscoverMake Quote Engine should combine:

```text
material
+ fabrication
+ tooling
+ finishing
+ assembly
+ QA
+ packaging
+ shipping
+ duties/tariffs when known
+ platform/payment cost
+ DiscoverMake margin
+ risk reserve
```

Every quote must have:

- source
- timestamp
- validity period when supplied
- confidence
- supplier status
- assumptions
- excluded costs
- design version

Never quote against a stale design version.

---

# 21. Repository structure

```text
discovermake/
│
├── apps/
│   ├── web/
│   ├── admin/
│   └── creator-console/
│
├── surfaces/
│   ├── make/
│   ├── live/
│   ├── build-workspace/
│   ├── creator-studio/
│   ├── ordering/
│   └── my-builds/
│
├── packages/
│   ├── ui/
│   ├── design-system/
│   ├── types/
│   ├── build-graph/
│   ├── live-protocol/
│   ├── events/
│   ├── commerce/
│   ├── permissions/
│   └── telemetry/
│
├── services/
│   ├── make-orchestrator/
│   ├── materials-engine/
│   ├── makeability-engine/
│   ├── quote-engine/
│   ├── manufacturing-router/
│   ├── accio-bridge/
│   ├── live-gateway/
│   ├── cad-worker/
│   └── reconstruction-worker/
│
├── agents/
│   ├── requirements/
│   ├── cad/
│   ├── materials/
│   ├── sourcing/
│   ├── costing/
│   ├── compliance/
│   └── live-cohost/
│
├── workflows/
│   ├── build/
│   ├── sourcing/
│   ├── quote/
│   ├── order/
│   ├── production/
│   └── live/
│
├── mcp/
│   └── discovermake-sourcing/
│
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── policies/
│
└── docs/
    ├── product/
    ├── architecture/
    ├── adr/
    └── runbooks/
```

---

# 22. Canonical Build state machine

```text
DRAFT
  ↓
REQUIREMENTS
  ↓
DESIGNING
  ↓
DESIGN_REVIEW
  ↓
MATERIAL_ANALYSIS
  ↓
DFM
  ↓
SOURCING
  ↓
QUOTING
  ↓
AWAITING_APPROVAL
  ↓
ORDERED
  ↓
MATERIAL_PROCUREMENT
  ↓
PRODUCTION
  ↓
QA
  ↓
ASSEMBLY
  ↓
PACKAGING
  ↓
SHIPPING
  ↓
DELIVERED
  ↓
PASSPORT_ACTIVE
```

Temporal owns workflow state.

The Build Graph owns engineering/product state.

Commerce owns payment/order state.

The Live Build Protocol owns what a live session is presenting.

The Product Passport owns the final manufactured record.

---

# 23. Core event vocabulary

```text
build.created
requirements.generated
requirements.approved
build.version.created
cad.generated
material.recommended
material.selected
makeability.calculated
sourcing.requested
sourcing.supplier_found
sourcing.offer_received
sourcing.negotiation_updated
quote.generated
quote.supplier_confirmed
quote.binding
order.created
payment.authorized
production.slot_claimed
production.scheduled
production.started
production.completed
inspection.created
inspection.passed
shipment.created
shipment.delivered
passport.activated
live.started
live.product.focused
live.remix.created
live.order.completed
```

---

# 24. Build order

## Phase 0 — audit current MVP

Do **not** rebuild what already works.

Inventory:

- existing routes
- database schema
- project records
- file upload/storage
- product discovery
- saved designs
- creation studio
- manufacturing brief exporter
- quote readiness

Then map current entities into the canonical Build schema.

## Phase 1 — foundation

Build:

- monorepo boundaries
- design system
- canonical types
- Build Graph
- event log
- Temporal
- OPA policies
- auth / organizations / permissions

## Phase 2 — MAKE + Build Workspace

Build:

- multimodal intake
- Requirements Agent
- Build Graph creation
- materials engine
- text-to-CAD/CadQuery worker
- Three.js/R3F object viewer
- Build Graph visualizer
- Makeability score

## Phase 3 — Accio sourcing bridge

Build:

- sourcing request contract
- MCP service
- sourcing job queue
- Accio Work agent group
- Alibaba connector
- RFQ workflow
- supplier offer normalization
- approval workflow

## Phase 4 — on-demand ordering

Build all six screens:

**Configure → Quote → Route → Approve → Build → Track**

Connect:

- Medusa
- payment provider
- quote states
- production slots
- order records

## Phase 5 — Creator Studio

Build:

- Build publishing
- pricing
- remix rights
- royalty rules
- show planning
- product queue
- build-slot drops

## Phase 6 — LIVE

Build:

- LiveKit rooms
- Owncast channels
- Live Build Protocol
- featured-product events
- Make This
- Remix
- Ask Creator
- Ask Make AI
- buy / claim build slot

## Phase 7 — My Builds / Passport

Build:

- manufacturing timeline
- production evidence
- QA records
- shipping
- Product Passport
- remix lineage

## Phase 8 — hardening

Test one end-to-end transaction repeatedly:

**Describe → Generate → Engineer → Source → Quote → Approve → Pay → Produce → QA → Ship → Passport.**

Then add:

**Publish → Live → Remix → Build Slot → Production.**

---

# 25. V1 Definition of Done

V1 is complete when a user can:

1. Describe a physical product.
2. Create a persistent Build.
3. Generate/edit requirements.
4. Generate or upload manufacturing geometry.
5. Receive materials and DFM recommendations.
6. Produce a BOM/process plan.
7. Send structured sourcing work to Accio Work automatically.
8. Receive multiple Alibaba/supplier offers back in DiscoverMake.
9. Compare manufacturing routes.
10. See estimate vs supplier-confirmed vs binding quote status.
11. Configure quantity/material/variant.
12. Pay and place an approved order.
13. Track production milestones.
14. Publish an approved Build as a creator product.
15. Go live using LiveKit/Owncast.
16. Feature the Build in the live room.
17. Let a viewer Make This / Remix / Buy / claim a Build Slot.
18. Carry that order through production.
19. Deliver it.
20. Activate its Product Passport.

---

# 26. The moat

The long-term moat is not any individual repository or model.

It is the compound dataset created after real manufacturing:

```text
Build Graph
+ material decisions
+ DFM outcomes
+ supplier quotes
+ negotiation outcomes
+ actual costs
+ production lead times
+ machine capability
+ QA outcomes
+ defect/remake outcomes
+ creator demand
+ live conversion
+ remix lineage
+ customer satisfaction
```

Once this dataset is large enough, DiscoverMake can answer:

> What is the safest, fastest, lowest-risk way to make this object, based on what actually happened when similar objects were produced?

That is when DiscoverMake becomes infrastructure rather than merely an app.

---

# 27. Public research references

- Xometry: https://www.xometry.com/
- Fictiv: https://www.fictiv.com/
- MakerVerse: https://www.makerverse.com/instant-quotes/
- Protolabs: https://www.protolabs.com/
- Dough: https://www.dough.do/
- Desmake: https://www.desmake.com/
- Accio Work: https://www.accio.com/work
- Accio Work connectors: https://www.accio.com/wow/doc-help-connectors.html
- Accio Work features / automation / MCP: https://www.accio.com/work/feature
- Alibaba.com: https://www.alibaba.com/

