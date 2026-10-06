# 03 · Accio sourcing bridge + Delivery Promise (the "Prime" layer)

**Goal:** customers can create, customize and discover anything and get one price and one guaranteed date, like Amazon Prime. The sourcing work happens in the background. That includes finding walnut stock, LED strips, an anodizer, or a CNC shop on Alibaba, sending RFQs, negotiating, and normalizing quotes. The customer sees **"Finding manufacturing partners…"** and then a Manufacturing Route.

Source: `docs/product/DISCOVERMAKE_MVP_SCORECARD_OPEN_SOURCE_ACCIO.md` §13–§20, and ADR-0005.

## Key fact: invert control

Accio Work (Alibaba International, launched March 2026) supports:
- an Alibaba.com connector
- Gmail and other connectors
- browser operation
- automated supplier email follow-up
- scheduled tasks
- custom skills
- multi-agent groups
- **MCP servers**
- an Alibaba-integrated **Sourcing Expert**

Its documentation also states that it does **not** expose an inbound Agent API, webhook, or deep-link endpoint.

So **DiscoverMake does not call Accio. Accio calls DiscoverMake.** DiscoverMake exposes its sourcing work as MCP tools. An Accio Work agent group runs on a schedule, pulls jobs, works them in the Alibaba ecosystem, and pushes structured offers back into the Build Graph.

```
Build reaches SOURCE stage
  → DiscoverMake creates SourcingRequest  (Postgres: sourcing_jobs = QUEUED)
  → Accio Work scheduled task → MCP discovermake.sourcing.next_job
  → Sourcing Expert + Alibaba connector: discovery → RFQs → follow-up → negotiation
  → normalized SupplierOffer → MCP discovermake.sourcing.submit_offer
  → DiscoverMake Quote Engine → OR-Tools route comparison
  → customer sees Quote / Manufacturing Route  (labelled by quote trust level)
  → human approval → purchase / payment / sample action  (inside DiscoverMake only)
```

## `services/accio-bridge`: the DiscoverMake Sourcing MCP server

Built with `modelcontextprotocol/typescript-sdk`. It is deployed as a remote MCP server (Streamable HTTP) with an OAuth or per-workspace bearer token, and only Accio Work workspaces on the allowlist can reach it.

| Tool | Purpose | Writes |
|---|---|---|
| `discovermake.sourcing.next_job` | Lease the next QUEUED job (visibility timeout, idempotent lease ID) | `sourcing_jobs.status = LEASED` |
| `discovermake.sourcing.get_job` | Full `SourcingRequest` + approval policy | — |
| `discovermake.sourcing.get_attachments` | Signed, expiring URLs. Only the redacted package unless the policy allows the full package | access log |
| `discovermake.sourcing.submit_supplier` | Register a candidate supplier with evidence | `suppliers`, `supplier_evidence` |
| `discovermake.sourcing.submit_offer` | Submit a normalized `SupplierOffer` (zod-validated) | `supplier_offers`, emits `sourcing.offer_received` |
| `discovermake.sourcing.update_negotiation` | Status and notes per supplier thread | emits `sourcing.negotiation_updated` |
| `discovermake.sourcing.attach_document` | Quotes, drawings back, certs, sample photos | object storage |
| `discovermake.sourcing.request_approval` | Ask for a human decision (release package, sample, substitution…) | `approvals`, notifies ops/customer |
| `discovermake.sourcing.complete_job` | Close the job with a summary | `sourcing_jobs.status = COMPLETE` |

Each tool call is authenticated, rate-limited, schema-validated and audit-logged. The bridge never lets a tool change engineering fields (geometry, material, tolerance) on the Build. Those change only through `request_approval` and a human decision.

### `SourcingRequest` (contracts/sourcing.schema.ts)

```json
{
  "sourcing_request_id": "SRC-20482", "build_id": "DM-10482", "design_version": 7, "part_id": "PART-009",
  "name": "CNC aluminum lamp arm", "quantity": 250, "target_unit_cost_usd": 18,
  "material": "6061-T6 aluminum", "process": ["CNC milling", "anodizing"],
  "dimensions_mm": {}, "critical_tolerances": [], "surface_finish": "matte black anodize",
  "required_certifications": [], "target_regions": ["US", "China", "Vietnam"],
  "target_delivery_date": null, "acceptable_substitutions": [],
  "attachments": ["STEP", "2D drawing", "BOM", "inspection requirements"],
  "approval_policy": { "allow_supplier_contact": true, "allow_negotiation": true,
                       "allow_sample_request": false, "allow_purchase": false }
}
```

### `SupplierOffer`

```json
{
  "supplier_offer_id": "OFF-88214", "sourcing_request_id": "SRC-20482",
  "supplier": { "name": "Example Precision Ltd.", "platform": "Alibaba", "verified": true, "country": "CN" },
  "quantity": 250, "unit_price_usd": 16.8, "tooling_usd": 0, "sample_cost_usd": 95, "moq": 100,
  "production_lead_days": 16, "shipping_lead_days": 8, "incoterm": "DDP",
  "processes": ["CNC milling", "anodizing"], "certifications_claimed": [], "exceptions": [],
  "attachments": [], "source_evidence": [], "confidence": 0.86,
  "negotiation_status": "supplier-confirmed", "valid_until": null
}
```

The schema rejects any offer that is stale against the current `design_version`.

## The Accio Work agent group (configured inside Accio)

| Agent | Job |
|---|---|
| **DiscoverMake Procurement Lead** (team lead) | Polls `next_job` on a schedule, assigns work, reports back with `complete_job` |
| Supplier Discovery | Finds qualified candidates through Alibaba / Accio sourcing |
| RFQ | Builds and sends RFQs with the approved technical package |
| Negotiation | Price, MOQ, lead time, tooling, samples, shipping terms, packaging, within the policy bounds |
| Supplier Verification | Checks Verified Supplier status, identity, capability, certifications, MOQ, lead time, location, evidence |
| Quote Normalization | Converts heterogeneous replies into `SupplierOffer` |
| Logistics | Incoterms, shipping lanes, Alibaba logistics data |

The agent group's prompts, skills and schedule are version-controlled in `mcp/discovermake-sourcing/accio-agent-group.md`, so changes are reviewed like code.

## Approval boundary (non-negotiable)

| Accio may do autonomously | Requires human approval in DiscoverMake |
|---|---|
| Search and compare suppliers | Release the full confidential design package to an unapproved supplier |
| Collect public evidence | Pay deposits |
| Draft RFQs; send **approved** RFQs | Place a purchase order |
| Follow up | Accept material substitutions that affect engineering requirements |
| Negotiate within defined bounds | Accept changed tolerances |
| Organize quotes, request clarifications | Approve tooling expense |
| Update sourcing records | Approve production or change safety/compliance requirements |

This keeps procurement decisions from silently changing the engineering definition. The boundary matters at every scale, from $50 parts to $50,000 machines. OPA policies (`database/policies/sourcing.rego`) enforce it at the bridge.

## Quote trust levels (shown on every price)

| Label | Meaning | Orderable? |
|---|---|---|
| **AI estimate** | Model or parametric estimate from the Build | No |
| **Supplier estimate** | Indicative supplier number, not confirmed against the full package | No |
| **Supplier-confirmed** | The supplier confirmed against this exact `design_version` and package | With approval |
| **Binding quote** | DiscoverMake commits to price and date (catalog parts from workflow 02, or confirmed offers plus risk reserve) | **Yes** |

Build trust states in the UI: **CONCEPT → ENGINEERING REVIEW → MANUFACTURING READY → SUPPLIER CONFIRMED → ORDERABLE**. Never make an AI concept look production-ready.

Quote composition, from scorecard §20:
- material, fabrication, tooling, finishing, assembly, QA, packaging, shipping
- duties and tariffs (when known)
- platform and payment cost, margin, risk reserve

Every quote records its source, timestamp, validity, confidence, supplier status, assumptions, excluded costs and design version.

## Other providers (same interface, different transport)

Accio is the long-tail sourcing department. A `SourcingProvider` interface (`packages/commerce/sourcing.ts`) also covers:
- **Shop stock:** pre-stocked sheet and hardware at partner shops. This is the fastest path and powers binding quotes in R1.
- **Catalog distributors:** fasteners, electronics, raw stock, through their partner APIs.
- **Sourcing desk:** DiscoverMake ops staff using Accio Work interactively for jobs the background group cannot finish.

## Delivery Promise engine

The customer sees **"Arrives Thu, Oct 23"**, never a range. The date is shown only when P90 ≤ that date.

```
promise = max(material_arrival_P90 across BOM) + shop_queue_P90 + process_time + QA + pack
        + carrier_transit_P90(zone, service) + buffer(risk_score)
```

- A missed promise auto-credits the customer, and the cost goes to the responsible leg.
- Predicted vs. actual is recorded per leg, and the P90 models retrain weekly.

## DiscoverMake Prime (R3)

- free shipping over a threshold
- priority shop-queue slots
- guaranteed dates with credits
- pooled material pricing
- early access to live drops

Onboarding offers a 7-day trial using the trial-timeline pattern from workflow 10.

## Events

- `sourcing.requested`
- `sourcing.supplier_found`
- `sourcing.offer_received`
- `sourcing.negotiation_updated`
- `sourcing.approval_requested`
- `quote.generated`
- `quote.supplier_confirmed`
- `quote.binding`
- `supplier.selected`
- `promise.set`
- `promise.at_risk`
- `promise.missed`

## Acceptance (R3, plus scorecard DoD items 7–10)

1. A Build at SOURCE automatically creates a `SourcingRequest`. Accio Work picks it up through `next_job` without manual action.
2. At least 3 normalized Alibaba/supplier offers come back through `submit_offer` and appear on the Manufacturing Route with trust labels.
3. Accio cannot place an order, release the full package, or change tolerances. Those tool paths return `APPROVAL_REQUIRED`, and the policy tests prove it.
4. Holdout testing shows a Promise hit rate ≥ 95%.
