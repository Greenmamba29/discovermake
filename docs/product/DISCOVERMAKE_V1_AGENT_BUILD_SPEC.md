# DISCOVERMAKE V1 — AGENT BUILD SPECIFICATION

> **Purpose:** Canonical build handoff for the agent completing DiscoverMake V1.
>
> **Primary product thesis:** DiscoverMake is the **On-Demand Creation Operating System** — a system where people can discover, design, engineer, source, manufacture, watch, remix, order, track, and own physical products.
>
> **Do not rebuild the existing product from scratch.** Extend the current MVP and preserve working features unless this specification explicitly replaces them.

---

## 0. EXECUTIVE BUILD DIRECTIVE

Build one connected application with five primary product surfaces:

1. **MAKE**
2. **LIVE**
3. **BUILD WORKSPACE**
4. **CREATOR STUDIO**
5. **MY BUILDS / ORDERS**

These are **not five separate apps**.

They are five views into the same persistent creation object:

# THE BUILD

- **MAKE creates it**
- **BUILD WORKSPACE engineers it**
- **CREATOR STUDIO publishes it**
- **LIVE sells/remixes it**
- **MY BUILDS / ORDERS tracks it through production and ownership**

The core transaction is not:

`Search → Buy → Ship`

It is:

`Imagine → Specify → Engineer → Source → Make → Verify → Deliver`

The consumer discovery loop is:

`Discover → Watch → Ask → Customize → Make → Buy → Follow → Share`

Together:

`DISCOVER → MAKE → WATCH → ORDER → BUILD → TRACK → REMIX`

---

# 1. CURRENT MVP — PRESERVE AND EXTEND

The current MVP already includes:

- Product discovery
- Saved designs
- Creation studio inputs
- Materials, quantities, and budget configuration
- Persistent editable projects
- Reference-file uploads
- Manufacturing-brief exports
- Quote-readiness tracking
- Open-source component research
- Working TypeScript production build
- Working database checks

The currently incomplete areas that V1 must connect are:

- AI design generation
- CAD generation
- Supplier quotes
- Payments
- Manufacturing integrations
- Live commerce
- Creator publishing/control
- End-to-end production state
- Product Passport

**Rule:** Reuse current working code and data flows wherever possible. Do not create parallel replacement systems unless an existing implementation cannot support the canonical architecture below.

---

# 2. PRODUCT POSITIONING

## 2.1 Core positioning

**DiscoverMake — The On-Demand Creation Operating System**

Amazon helps users buy something that already exists.

DiscoverMake should help users:

- create something that does not yet exist
- reconstruct something that used to exist
- customize an existing design
- manufacture a known product
- discover a product live and remix it
- commission a custom version
- source materials/components
- route production
- track manufacturing
- own a permanent Product Passport

---

# 3. PRODUCT DESIGN DIRECTION

The visual system should feel like:

**Industrial design studio × premium marketplace × engineering control room × live commerce network**

Avoid:

- generic SaaS
- generic AI chatbot UI
- Amazon clone
- TikTok clone
- traditional CAD complexity
- childish AI visuals
- overly decorative dashboards

## 3.1 Design principles

### Object-first
The physical product is the center of the interface.

### AI surrounds the object
AI should provide context, options, risk flags, and actions around the object rather than replacing the entire interface with chat.

### Premium industrial minimalism
Warm white editorial surfaces, graphite UI, precision spacing, strong product imagery, technical annotations, minimal noise.

### Materials should feel physical
Use high-quality material swatches and close-up texture imagery where helpful.

### Real process creates trust
Production states, supplier status, QA, and delivery should be visible rather than hidden behind generic "processing" messages.

### One signal color
Use one energetic accent for:
- LIVE
- production activity
- accepted state
- Makeability readiness
- critical CTA

---

# 4. GLOBAL APPLICATION INFORMATION ARCHITECTURE

Primary navigation:

- **Discover**
- **Make**
- **Live**
- **My Builds**
- **Creator Studio**
- **Account / Organization**

Secondary contextual destinations:

- Build Workspace
- Materials
- Reconstruct
- Robots
- Product Passport
- Supplier / Factory profiles

Recommended top-level routes:

```txt
/
 /discover
 /make
 /make/new
 /make/:buildId

 /live
 /live/following
 /live/upcoming
 /live/:sessionId
 /channel/:creatorSlug
 /replay/:sessionId

 /build/:buildId

 /studio
 /studio/products
 /studio/builds
 /studio/live
 /studio/content
 /studio/orders
 /studio/audience
 /studio/revenue

 /builds
 /builds/created
 /builds/remixed
 /builds/ordered
 /builds/following

 /orders
 /orders/:orderId

 /passport/:passportId
```

---

# 5. SHARED SYSTEM OBJECTS

All five surfaces MUST share the same canonical entities.

```txt
User
Creator
Organization

Product
Build
BuildGraph
Requirement
DesignVersion

Assembly
Part
MaterialSpec
MaterialCandidate
ProcessPlan
CADArtifact
BOMItem

Supplier
SupplierOffer
Facility
MachineCapability

Quote
Order
Payment
ManufacturingJob
Shipment

LiveChannel
LiveSession
LiveProductEvent
BuildSlot

CreatorContent
Clip
Replay

InspectionPlan
InspectionResult

ProductPassport
```

No surface should create a parallel "version" of these entities.

---

# 6. THE BUILD GRAPH — CORE DATA MODEL

The Build Graph is the digital DNA of the physical product.

## 6.1 Required nodes

```txt
Product
Build
DesignVersion
Requirement
Assembly
Part
MaterialSpec
MaterialCandidate
ProcessPlan
MachineCapability
Facility
Supplier
SupplierOffer
BOMItem
CADArtifact
ManufacturingJob
RobotOperation
InspectionPlan
InspectionResult
AssemblyStep
Package
Shipment
ProductPassport
```

## 6.2 Required relationships

```txt
CONTAINS
MADE_OF
REPLACES
MATES_WITH
REQUIRES_PROCESS
MANUFACTURED_BY
CAN_BE_MANUFACTURED_BY
SOURCED_FROM
INSPECTED_BY
ASSEMBLED_WITH
VERSION_OF
DERIVED_FROM
DELIVERED_BY
```

## 6.3 Common metadata

```txt
id
build_id
version
status
confidence
source
provenance
created_by
approved_by
created_at
updated_at
supersedes
```

Use Postgres node/edge tables for V1. Do not introduce a graph database unless there is a demonstrated V1 blocker.

---

# 7. SURFACE 1 — MAKE

## 7.1 Purpose

MAKE answers:

> **What do you want to make?**

It is the universal intake for physical creation.

## 7.2 Accepted inputs

- text
- voice
- image
- sketch
- product URL
- CAD file
- video
- broken object photo
- measurements
- existing DiscoverMake Build
- existing DiscoverMake product
- reference files

## 7.3 First screen

Primary hero:

> **What do you want to make?**

Input actions:

- Describe
- Upload Image
- Upload CAD
- Reconstruct
- Build From Scratch

Optional starters:

- Recreate something
- Invent something
- Modify a product
- Manufacture my design
- Find a better material

## 7.4 MAKE pipeline

```txt
INPUT
↓
INTENT NORMALIZATION
↓
REQUIREMENTS
↓
UNKNOWN DETECTION
↓
PRODUCT DECOMPOSITION
↓
INITIAL BUILD GRAPH
↓
MATERIAL RECOMMENDATION
↓
CAD / GEOMETRY
↓
PROCESS SELECTION
↓
MAKEABILITY
↓
PRELIMINARY QUOTE
↓
BUILD WORKSPACE
```

## 7.5 Canonical Creation Intent object

```json
{
  "intent": "create",
  "product_type": "outdoor enclosure",
  "requirements": [],
  "constraints": [],
  "unknowns": [],
  "risk_class": "standard",
  "required_specialists": [],
  "required_evidence": []
}
```

## 7.6 V1 specialist agents

- Requirements Agent
- Materials Engineer
- CAD Agent
- Makeability Agent
- Cost Agent
- Sourcing Agent

User sees one unified **Make AI**.

## 7.7 Components

```txt
MakePrompt
InputAttachmentTray
CreationIntentCard
RequirementEditor
UnknownsPanel
ConceptViewer
MaterialRecommendation
MakeabilityCard
CostEstimate
BuildCTA
```

## 7.8 Writes

```txt
Build
Requirement
BuildGraph
DesignVersion
MaterialCandidate
CADArtifact
ProcessPlan
QuoteEstimate
```

## 7.9 Events

```txt
build.created
requirements.generated
requirements.approved
design.generated
material.recommended
makeability.calculated
quote.preliminary
```

## 7.10 Acceptance test

Input:

> Make me a weatherproof outdoor enclosure for a Raspberry Pi with a solar battery.

The system must create:

1. structured requirements
2. missing-information list
3. part decomposition
4. suggested materials
5. initial geometry/CAD
6. preliminary BOM
7. process recommendations
8. Makeability score
9. preliminary price range
10. estimated production time
11. persistent Build

---

# 8. SURFACE 2 — BUILD WORKSPACE

## 8.1 Purpose

This is the operational heart of DiscoverMake.

Route:

```txt
/build/:buildId
```

## 8.2 Layout

Left navigation:

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

Center:

- 3D product viewport
- annotations
- measurements
- assembly views
- version previews

Right:

- Make AI
- suggestions
- questions
- warnings
- required approvals
- next actions

Persistent status strip:

- Makeability
- Cost
- Lead Time
- Confidence
- Version

## 8.3 Core views

### Overview
Build health and next action.

### Design
CAD, dimensions, revisions, annotations.

### Parts
Assembly tree, part tree, BOM.

### Materials
Primary and substitute materials, properties, cost, sustainability, risks.

### Process
Manufacturing sequence.

Example:

```txt
CNC
↓
Deburr
↓
Anodize
↓
Laser mark
↓
Inspect
↓
Assemble
```

### Source
Accio-powered material/part/supplier discovery.

### Quotes
Compare manufacturing routes.

### Production
ManufacturingJob state and milestones.

### QA
Inspection plans/results.

### Delivery
Packaging and shipping.

### Passport
Final production record.

## 8.4 Required Build Graph viewer

Two modes:

### Object View
3D model

### Graph View

```txt
PRODUCT
├── ASSEMBLY
│   ├── PART
│   │   └── MATERIAL
│   └── PART
│       └── MATERIAL
├── PROCESS PLAN
├── SUPPLIER
├── FACTORY
├── QA PLAN
└── DELIVERY
```

## 8.5 Versioning

Never overwrite important manufacturing/design data silently.

Each meaningful change creates a `DesignVersion`.

Example:

```txt
V4 Aluminum
V5 Aluminum + larger vent
V6 Polycarbonate
V7 Polycarbonate + waterproof gasket
```

## 8.6 State machine

```txt
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
QUOTING
↓
SOURCING
↓
AWAITING_APPROVAL
↓
PROCUREMENT
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

## 8.7 Components

```txt
BuildShell
BuildNavigation
ObjectViewport
GraphViewer
RequirementPanel
DesignPanel
PartTree
BOMTable
MaterialsPanel
ProcessTimeline
SupplierPanel
QuoteComparison
ProductionTimeline
InspectionPanel
DeliveryPanel
PassportViewer
MakeAgentPanel
```

---

# 9. SURFACE 3 — LIVE

## 9.1 Purpose

LIVE answers:

> What are people making right now?

and:

> Can I buy, customize, remix, or commission it?

## 9.2 Architecture

Use:

- **LiveKit** for interactive realtime rooms
- **Owncast** for creator broadcast/channel behavior
- **DiscoverMake Live Build Protocol** for product state and commerce meaning

MediaMTX may be added later for universal RTMP/SRT/RTSP/industrial camera ingestion.

## 9.3 LiveKit responsibilities

- host
- co-host
- guest
- viewer participation
- Make AI presence
- Materials AI presence
- realtime data events
- polls
- reactions
- bring viewer on stage
- synchronized product state

## 9.4 Owncast responsibilities

- creator channels
- public broadcast
- scheduled programming
- persistent creator identity
- broadcast community
- replay-oriented content
- self-hosted channel layer

## 9.5 Live formats for V1

- Creator Live
- Product Demo
- Live Drop
- Build Live
- Factory Live

## 9.6 Viewer actions

- BUY
- MAKE THIS
- REMIX
- ASK CREATOR
- ASK MAKE AI
- FOLLOW
- SHARE
- SAVE
- CLAIM BUILD SLOT

## 9.7 Live product overlay

Never burn dynamic commerce state into video.

Send it as synchronized data.

Example:

```json
{
  "event": "product.focus",
  "session_id": "LIVE-984",
  "build_id": "DM-10482",
  "design_version": 7,
  "variant_id": "walnut-v4",
  "price": 168,
  "lead_time_days": 6,
  "makeability": 94,
  "available_build_slots": 117
}
```

## 9.8 Proprietary LIVE BUILD PROTOCOL

```txt
product.focus
product.compare
variant.focus
material.change
price.change
inventory.change

remix.started
remix.created

drop.started
drop.closed

build_slot.claimed

question.created
question.answered

machine.started
machine.completed

inspection.passed

order.created
order.completed
```

The streaming platforms transport events.

**DiscoverMake owns their meaning.**

## 9.9 Build-slot commerce

DiscoverMake should be able to sell production capacity rather than stocked inventory.

Example:

```txt
CARBON FIBER DESK LAMP

Production Run
193 / 250 slots claimed

$184

Production begins when:
200 slots claimed

[CLAIM BUILD SLOT]
```

## 9.10 Live acceptance criteria

A viewer can:

1. enter stream
2. see featured product
3. ask creator
4. ask Make AI
5. see product state change in realtime
6. select variant
7. Make This
8. Remix
9. Buy
10. claim manufacturing slot

without leaving the live experience.

---

# 10. SURFACE 4 — CREATOR STUDIO

## 10.1 Purpose

Creator Studio answers:

> What am I showing, selling, making, and earning?

## 10.2 Main routes

```txt
/studio
/studio/products
/studio/builds
/studio/live
/studio/content
/studio/orders
/studio/audience
/studio/revenue
```

## 10.3 Dashboard metrics

- Revenue
- Product Revenue
- Build Slots Sold
- Live Viewers
- Remix Royalties
- Orders
- Conversion
- Watch time

## 10.4 Publish states

A creator can mark a Build:

```txt
PRIVATE
SHAREABLE
PUBLIC
FOR_SALE
REMIXABLE
LIVE_ELIGIBLE
```

## 10.5 Publishing workflow

```txt
BUILD
↓
PUBLISH
↓
PRODUCT PAGE
↓
LIVE ELIGIBLE
↓
REMIX POLICY
↓
ROYALTY POLICY
↓
PRICING
↓
LAUNCH
```

## 10.6 Live Show Control

Show:

- current product
- next product
- viewers
- sales
- build slots
- questions

Actions:

- Feature Product
- Start Drop
- Ask Make AI
- Bring Viewer On
- Clip Moment
- End Show

## 10.7 Show planner

Objects:

```txt
Show
Segment
Product
TalkingPoint
Build
Drop
Poll
Guest
CTA
```

## 10.8 Creator economics

V1 data model should support:

- product commission
- Build Recipe royalty
- remix royalty
- live sales commission
- affiliate / UGC commission
- factory production revenue

Not every payout path must automate in the first release, but the schema must support it.

## 10.9 Components

```txt
StudioDashboard
ProductManager
BuildPublisher
ChannelManager
ShowPlanner
LiveControlRoom
ProductQueue
LiveAnalytics
ClipManager
ReplayManager
OrderDashboard
AudienceDashboard
RevenueDashboard
RoyaltyDashboard
```

---

# 11. SURFACE 5 — MY BUILDS / ORDERS

## 11.1 Purpose

One place for everything the user has:

- created
- remixed
- ordered
- commissioned
- saved
- manufactured

Do not split buyer history and maker history into disconnected products.

## 11.2 Main views

```txt
/builds
/builds/created
/builds/remixed
/builds/ordered
/builds/following

/orders
/orders/:orderId
```

## 11.3 Card states

Example:

```txt
Solar Pi Housing
IN PRODUCTION
74%

Walnut Desk Lamp
DESIGN
Waiting for approval

Titanium Bottle
DELIVERED
Product Passport Available
```

## 11.4 Production tracking

Do not reduce order state to:

```txt
Processing
Shipped
```

Show:

```txt
DESIGN LOCKED
MATERIAL ORDERED
MATERIAL RECEIVED
MACHINE RESERVED
FABRICATION
QA
ASSEMBLY
PACKAGING
SHIPPED
DELIVERED
```

## 11.5 WATCH MY BUILD

Where permission exists, show scoped production video.

Example:

```txt
● PRODUCTION LIVE

Machine 04
Housing milling
64%

[WATCH]
```

Do not expose unrestricted factory surveillance.

## 11.6 Product Passport

When delivered, show:

- Design Version
- Manufacturing date
- Materials
- Factory
- Supplier lineage
- Repair instructions
- Replacement parts
- Assembly
- Original creator
- Remix lineage
- QA results
- batch / lot

---

# 12. ON-DEMAND ORDERING FRAMEWORK — REQUIRED SCREENS

This is a required V1 layer and must not be omitted.

The order framework has six connected screens:

# CONFIGURE → QUOTE → ROUTE → APPROVE → BUILD → TRACK

---

## 12.1 SCREEN 01 — CONFIGURE ORDER

Purpose:

Customize the product before quote.

Required controls:

- Product visual / 3D
- Variant
- Material
- Finish
- Dimensions
- Quantity
- Notes
- Optional branding / personalization
- Sustainability preference
- Save Draft

Primary CTA:

> **Save & Get Quote**

Recommended route:

```txt
/build/:buildId/configure
```

---

## 12.2 SCREEN 02 — INSTANT QUOTE

Purpose:

Turn configuration into understandable production economics.

Show pricing tiers:

### Prototype
- low quantity
- highest unit price
- fastest validation
- design feedback

### Small Batch
- 10–250 units
- recommended launch/test tier
- balanced pricing

### Production Run
- large quantity
- lowest unit price
- scheduled production

Show:

- unit price
- total
- materials
- manufacturing
- finishing
- QA
- packaging
- tooling if applicable
- estimated lead time

Primary CTA:

> **Continue to Manufacturing Route**

Recommended route:

```txt
/build/:buildId/quote
```

---

## 12.3 SCREEN 03 — MANUFACTURING ROUTE

Purpose:

Choose how and where the product will be made.

Supplier/factory cards should expose:

- name
- location
- rating / performance
- capabilities
- process compatibility
- certifications
- MOQ
- unit cost
- tooling
- lead time
- quality score
- sustainability / logistics impact where available

Tabs:

- Suppliers
- Processes
- Impact

Primary CTA:

> **Select Supplier / Route**

Recommended route:

```txt
/build/:buildId/route
```

---

## 12.4 SCREEN 04 — APPROVAL + CHECKOUT

Purpose:

Lock the product configuration and authorize production.

Required:

- product summary
- design version
- material
- finish
- dimensions
- quantity
- unit price
- subtotal
- shipping address
- shipping method
- payment method
- final policy acknowledgement
- production approval

Payment options architecture:

- Card
- ACH
- Wire
- optional PayPal if already supported

Primary CTA:

> **Pay & Start Production**

Recommended route:

```txt
/build/:buildId/approve
```

Important:

Payment success must create:

- Order
- Payment
- approved DesignVersion
- production authorization event

---

## 12.5 SCREEN 05 — PRODUCTION RUN

Purpose:

Show the customer that their Build has entered physical production.

Show:

- Build Slot Confirmed
- Quantity
- Production run
- Estimated start
- Estimated completion
- Current status
- Capacity threshold
- MOQ / batch progress
- Recent activity
- production milestones

If aggregate capacity model is used:

```txt
38 / 50 units
76%
```

or:

```txt
193 / 250 build slots claimed
```

Actions:

- View production milestones
- Share project / drop
- add quantity where valid

Recommended route:

```txt
/orders/:orderId/production
```

---

## 12.6 SCREEN 06 — ORDER TRACKING

Purpose:

From factory to customer.

Show:

```txt
Design
Materials
Production
QA
Shipping
Delivered
```

Include:

- map / shipment tracking when appropriate
- live updates
- shipment milestones
- Product Passport preview
- currently-in-production card
- production video where available

Recommended route:

```txt
/orders/:orderId
```

---

# 13. COMMERCE MODEL

DiscoverMake must support more than simple inventory SKU checkout.

Order types:

```txt
STOCKED_PRODUCT
MADE_TO_ORDER
CUSTOM_BUILD
REMIX_BUILD
PROTOTYPE
SMALL_BATCH
PRODUCTION_RUN
BUILD_SLOT
LIVE_DROP
```

This enum should be explicit in the data model.

---

# 14. MAKE COMPILER

The proprietary orchestration layer transforms human intent into manufacturable work.

Pipeline:

```txt
Requirements
↓
Engineering Spec
↓
CAD
↓
BOM
↓
Materials
↓
Process Selection
↓
Machine Requirements
↓
Supplier Graph
↓
Production Routing
↓
Robot / Machine Instructions
↓
Inspection
↓
Assembly
↓
Packaging
↓
Delivery
```

For V1, do not autonomously execute machines.

V1 ends at human-approved production routing and controlled adapter submission.

---

# 15. MATERIALS ENGINEER

Do not implement materials as a generic chat box.

The Materials Engineer should answer structured questions using:

- mechanical requirements
- environmental exposure
- geometry
- process
- finish
- cost
- availability
- sustainability
- substitutions

It should return:

```txt
Recommended Material
Why
Alternatives
Tradeoffs
Risk
Process Compatibility
Cost Effect
Lead-Time Effect
Confidence
```

---

# 16. RECONSTRUCTION MODE

Required architecture even if advanced reconstruction is later than initial launch.

Inputs:

- photo
- video
- measurements
- depth scan
- broken component
- legacy CAD
- manuals

Pipeline:

```txt
Input
↓
Object isolation
↓
Geometry reconstruction
↓
Feature extraction
↓
Part decomposition
↓
Material hypothesis
↓
Parametric CAD
↓
Missing-dimension questions
↓
Reconstruction Confidence
↓
Human confirmation
↓
Makeability
```

Never silently guess critical manufacturing dimensions.

---

# 17. OPEN-SOURCE FOUNDATION

Use open source to implement commodity infrastructure.

Recommended V1 responsibilities:

## Frontend / UX
- React
- TypeScript
- existing shadcn-based design system
- Three.js for 3D viewer

## App data
- Postgres
- existing database layer / Supabase where already integrated

## Agent orchestration
- OpenAI Agents SDK or current approved agent framework

## Durable workflows
- Temporal

## Policy
- OPA

## CAD
- text-to-cad
- CadQuery
- FreeCAD validation where required

## Reconstruction
- OpenCV
- SAM2
- COLMAP
- Open3D

## Search
- Meilisearch
- Qdrant later for multimodal similarity

## Commerce
- Medusa core where helpful

## Routing
- OR-Tools

## Sourcing
- Accio Work

## Live
- LiveKit
- Owncast

## Robotics later
- ROS2
- LeRobot
- MuJoCo

Strong-copyleft manufacturing tooling must remain isolated and receive licensing review before embedding.

---

# 18. SOURCE-OF-TRUTH RULES

## Build Graph
Truth for:

> what the product is

## Temporal
Truth for:

> what is happening to it

## Commerce / Orders
Truth for:

> what was purchased and paid for

## Live Build Protocol
Truth for:

> what a live session is currently presenting

## Product Passport
Truth for:

> what was ultimately manufactured

Do not blur these responsibilities.

---

# 19. SHARED EVENT MODEL

Every major transition should emit a domain event.

Core events:

```txt
build.created
build.updated

requirements.generated
requirements.approved

design.generated
design.updated
design.approved

material.recommended
material.selected

makeability.completed

quote.created
quote.updated
quote.approved

supplier.selected
route.approved

order.created
payment.completed

build.published

live.started
live.ended
product.featured

remix.started
remix.created

build_slot.claimed

procurement.started
materials.received

production.started
production.milestone
production.completed

inspection.started
inspection.passed
inspection.failed

shipment.created
shipment.updated

product.delivered
passport.activated
```

Events must have:

```txt
event_id
event_type
build_id
actor_id
timestamp
payload
correlation_id
causation_id
```

---

# 20. GITHUB / MONOREPO STRUCTURE

Use one monorepo.

```txt
discovermake/
│
├── apps/
│   ├── web/
│   │   ├── make/
│   │   ├── live/
│   │   ├── build-workspace/
│   │   ├── creator-studio/
│   │   └── my-builds/
│   │
│   ├── worker/
│   └── admin/
│
├── packages/
│   ├── ui/
│   ├── design-system/
│   ├── auth/
│   ├── build-graph/
│   ├── live-protocol/
│   ├── commerce/
│   ├── events/
│   ├── permissions/
│   ├── telemetry/
│   └── types/
│
├── services/
│   ├── make-orchestrator/
│   ├── materials-engine/
│   ├── makeability-engine/
│   ├── quote-engine/
│   ├── sourcing/
│   ├── live-gateway/
│   ├── livekit-adapter/
│   ├── owncast-adapter/
│   ├── cad-worker/
│   ├── reconstruction-worker/
│   └── manufacturing-router/
│
├── agents/
│   ├── make-agent/
│   ├── requirements-agent/
│   ├── materials-agent/
│   ├── cad-agent/
│   ├── sourcing-agent/
│   └── live-agent/
│
├── workflows/
│   ├── build/
│   ├── quote/
│   ├── order/
│   ├── production/
│   └── live/
│
├── database/
│   ├── schema/
│   ├── migrations/
│   ├── seeds/
│   └── policies/
│
├── contracts/
│   ├── build.schema.ts
│   ├── live-event.schema.ts
│   ├── quote.schema.ts
│   ├── order.schema.ts
│   └── manufacturing.schema.ts
│
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   └── runbooks/
│
└── tests/
    ├── contracts/
    ├── integration/
    └── e2e/
```

If the current repository structure differs materially, migrate toward this architecture incrementally rather than performing a destructive rewrite.

---

# 21. SURFACE MANIFESTS

Each surface should expose a machine-readable manifest.

Example:

```ts
export const makeSurface = {
  id: "make",
  routes: ["/make", "/make/new", "/make/:buildId"],
  reads: ["Build", "Requirement", "DesignVersion"],
  writes: ["Build", "Requirement", "CADArtifact", "MaterialCandidate"],
  emits: [
    "build.created",
    "requirements.generated",
    "design.generated"
  ],
  consumes: [
    "quote.updated",
    "material.updated"
  ]
};
```

Create equivalents for:

- live
- build-workspace
- creator-studio
- my-builds

---

# 22. DESIGN SYSTEM PACKAGE

Create / preserve:

```txt
packages/design-system
```

Tokens:

```txt
color
typography
spacing
radius
shadow
motion
layers
breakpoints
```

Shared components:

```txt
DMButton
DMInput
DMCard

StatusPill
ConfidenceBadge
MakeabilityScore

ProductCard
BuildCard
MaterialCard
QuoteCard

ObjectViewport
TechnicalData
MetricStrip

LiveBadge
ViewerCount
DropCounter

AgentPanel
AgentMessage
AgentAction

Timeline
BuildStage
EventMarker
```

---

# 23. UNIVERSAL STATUS LANGUAGE

Use one status vocabulary everywhere.

```txt
DRAFT
ANALYZING
NEEDS_INPUT
READY
REVIEW
IN_PRODUCTION
LIVE
COMPLETE
FAILED
CANCELLED
```

Do not invent separate status names per screen.

---

# 24. MOBILE PRODUCT RULES

Do not simply shrink desktop.

## MAKE
Camera-first creation.

## LIVE
Full-screen vertical video.

## BUILD WORKSPACE
Object + current next action.

## CREATOR STUDIO
Broadcast control / metrics.

## MY BUILDS
Production tracking.

Desktop exposes engineering depth.

Mobile exposes state and action.

---

# 25. BUILD ORDER

## PHASE 0 — REPOSITORY AUDIT

Before modifying code:

1. inventory existing routes
2. inventory working database schema
3. identify current project/build entities
4. identify file upload implementation
5. identify current manufacturing brief
6. identify quote-readiness logic
7. identify working UI components
8. identify authentication
9. identify current deployment path
10. document what is retained vs replaced

Output:

```txt
docs/architecture/current-state.md
```

---

## PHASE 1 — FOUNDATION

Build / normalize:

- Design System
- Auth
- canonical shared types
- Build entity
- Build Graph
- Event model
- application shell
- permissions
- file references
- version model

Definition of done:

All five surfaces can read the same Build by ID.

---

## PHASE 2 — MAKE + BUILD WORKSPACE

Connect:

```txt
Idea
→ Requirements
→ Build Graph
→ Materials
→ CAD
→ Makeability
→ Preliminary Quote
```

The Build must persist.

No mock state on the critical path.

---

## PHASE 3 — ON-DEMAND ORDERING

Build all six required screens:

1. Configure
2. Quote
3. Manufacturing Route
4. Approval + Checkout
5. Production Run
6. Order Tracking

Connect quote and order data to Build.

---

## PHASE 4 — CREATOR STUDIO

Add:

- Build publishing
- public product state
- Remix permissions
- royalty metadata
- show planning
- creator metrics
- product queue

---

## PHASE 5 — LIVE

Integrate:

- LiveKit
- Owncast
- Live Build Protocol
- product focus events
- Make AI in live
- Remix from live
- Buy / Build Slot from live

---

## PHASE 6 — MY BUILDS / ORDERS

Connect:

```txt
idea
→ design
→ quote
→ approval
→ payment
→ sourcing
→ production
→ QA
→ shipment
→ delivered
→ passport
```

---

## PHASE 7 — END-TO-END HARDENING

Remove remaining fake data from critical path.

Add:

- integration tests
- contract tests
- event replay tests
- payment failure states
- supplier timeout states
- production error states
- permissions
- retries
- audit history
- analytics
- browser QA

---

# 26. GITHUB EPICS

Create:

```txt
EPIC-001 Shared Platform
EPIC-100 MAKE
EPIC-200 LIVE
EPIC-300 BUILD WORKSPACE
EPIC-400 CREATOR STUDIO
EPIC-500 MY BUILDS / ORDERS
EPIC-600 Build Graph
EPIC-700 MAKE Compiler
EPIC-800 Live Infrastructure
EPIC-900 Commerce + On-Demand Ordering
EPIC-1000 Product Passport
```

Each epic should have:

- objective
- dependencies
- acceptance criteria
- routes
- data objects
- API/contracts
- events
- UI components
- test plan
- demo script

---

# 27. DEPENDENCY RULE

A surface MAY depend on:

```txt
packages/*
contracts/*
shared APIs
domain events
```

A surface MUST NOT import internal implementation code from another surface.

Bad:

```txt
live imports build-workspace internal React state
```

Good:

```txt
live calls BuildGraph.createRemix()
```

---

# 28. NO-FAKE-STATE RULE

Do not mark V1 complete if any of these critical flows are mocked:

- Build persistence
- requirements persistence
- quote persistence
- payment confirmation
- selected supplier / route
- order creation
- production status
- live product selection
- remix creation
- Product Passport generation

UI prototypes may use fixtures during development, but the final V1 critical path must use real application state.

---

# 29. PAYMENT + PRODUCTION GUARDRAIL

Never route:

```txt
LLM → machine
```

Use:

```txt
LLM
→ structured Build Plan
→ deterministic validation
→ policy
→ human approval
→ signed manufacturing job
→ machine/factory adapter
→ inspection
```

---

# 30. V1 DEMO SCENARIO

This is the canonical demo and end-to-end acceptance test.

## Step 1 — MAKE

Creator enters:

> Create a walnut desk lamp with a curved aluminum arm.

System creates:

- Build
- requirements
- materials
- initial design
- BOM
- Makeability
- cost estimate

## Step 2 — BUILD WORKSPACE

Creator adjusts dimensions.

Approves Design Version V3.

## Step 3 — CONFIGURE + QUOTE

Creator chooses:

- Walnut
- Matte finish
- 100 units

System generates:

- Prototype pricing
- Small Batch pricing
- Production Run pricing

## Step 4 — ROUTE

Creator compares:

- supplier A
- supplier B
- supplier C

and selects a manufacturing route.

## Step 5 — CREATOR STUDIO

Creator publishes Build.

Sets:

- For Sale
- Remixable
- royalty %
- live eligibility

Schedules product launch.

## Step 6 — LIVE

Creator demonstrates the product.

Viewer asks:

> Can I get it in black walnut?

Make AI evaluates the material variation.

Viewer taps:

**REMIX**

System creates:

```txt
Desk Lamp V3
→ Viewer Remix V1
→ Black Walnut
```

System shows:

- updated price
- lead time
- Makeability

Viewer taps:

**MAKE IT**

## Step 7 — APPROVAL + CHECKOUT

Viewer reviews and pays.

Order is created.

## Step 8 — PRODUCTION RUN

Viewer sees:

- Build Slot
- materials
- production start
- milestones
- QA

## Step 9 — MY BUILDS

Viewer tracks the product until delivery.

## Step 10 — PRODUCT PASSPORT

Delivered unit receives permanent Product Passport.

---

# 31. V1 DEFINITION OF DONE

DiscoverMake V1 is complete when one person can:

```txt
DESCRIBE SOMETHING
↓
GENERATE A BUILD
↓
EDIT THE BUILD
↓
CONFIGURE THE ORDER
↓
GET A QUOTE
↓
CHOOSE A MANUFACTURING ROUTE
↓
PUBLISH IT
↓
SHOW IT LIVE
↓
ALLOW ANOTHER PERSON TO REMIX IT
↓
PRICE IT
↓
PAY FOR IT
↓
ENTER PRODUCTION
↓
TRACK PRODUCTION
↓
TRACK SHIPMENT
↓
RECEIVE A PRODUCT PASSPORT
```

without leaving DiscoverMake.

---

# 32. WHAT IS NOT V1

Do not block V1 on:

- autonomous CNC
- autonomous robot execution
- global decentralized factory federation
- every manufacturing process
- MES replacement
- ERP replacement
- advanced generative video
- StreamPlace-style decentralized network
- fully automated reconstruction
- AR manufacturing
- blockchain-only Product Passport
- enterprise robotics orchestration

Architecture may anticipate these.

V1 does not require them.

---

# 33. AGENT OPERATING INSTRUCTIONS

When executing this build:

1. **Audit before rewriting.**
2. **Preserve existing working flows.**
3. **Use the canonical objects in this spec.**
4. **Do not create five isolated apps.**
5. **Do not create duplicate Build records.**
6. **Use one Build ID across all surfaces.**
7. **Keep AI outputs structured.**
8. **Never silently infer missing manufacturing-critical dimensions.**
9. **Add events for meaningful state transitions.**
10. **Do not use mock data on the final critical path.**
11. **Keep manufacturing execution human-approved in V1.**
12. **Document architecture decisions in `/docs/adr`.**
13. **Add tests as each surface becomes functional.**
14. **Keep all UI aligned to the DiscoverMake design system.**
15. **Optimize for the canonical end-to-end demo, not isolated feature completion.**

---

# 34. FIRST AGENT TASK

Start by producing:

```txt
docs/architecture/current-state.md
docs/architecture/target-state.md
docs/product/v1-surface-map.md
docs/product/on-demand-ordering.md
docs/product/live-commerce.md
docs/adr/0001-build-graph-source-of-truth.md
docs/adr/0002-event-model.md
docs/adr/0003-livekit-owncast-boundary.md
docs/adr/0004-commerce-order-types.md
```

Then create the GitHub epics and issue breakdown.

After that, implement Foundation → MAKE → Build Workspace → Ordering → Creator Studio → LIVE → My Builds.

---

# 35. FINAL PRODUCT RULE

Every engineering decision must answer:

> Does this strengthen the persistent relationship between the physical object, its Build Graph, its creator, its manufacturing state, and the person interacting with it?

If not, it probably does not belong in V1.

# MAKE creates the Build.
# BUILD WORKSPACE engineers it.
# CREATOR STUDIO publishes it.
# LIVE makes it discoverable, remixable, and transactable.
# MY BUILDS carries it through reality.

That is DiscoverMake V1.
