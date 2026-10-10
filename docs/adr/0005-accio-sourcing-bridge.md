# ADR-0005 · Accio Work integration by inverted control (DiscoverMake MCP server)

- **Status:** Accepted (draft for G2 review)
- **Date:** 2026-10-06

## Context
We want an Amazon-Prime-like experience: one price, one date, any material or part. Sourcing work should run invisibly through Alibaba's ecosystem.

Accio Work (launched 23 Mar 2026) supports:
- an Alibaba.com connector
- email automation
- browser operation
- scheduled tasks
- custom skills
- multi-agent groups
- MCP servers

Its documentation states there is **no inbound Agent API or webhook**.

## Decision
- **Invert control.** DiscoverMake runs `services/accio-bridge`, a remote MCP server built on `modelcontextprotocol/typescript-sdk`. It exposes `discovermake.sourcing.*` tools: `next_job`, `get_job`, `get_attachments`, `submit_supplier`, `submit_offer`, `update_negotiation`, `attach_document`, `request_approval`, `complete_job`.
- An Accio Work **agent group** polls on a schedule, works jobs through the Alibaba Sourcing Expert, and writes structured `SupplierOffer`s back. The agent group is configured as reviewed text in `mcp/discovermake-sourcing/`.
- **Approval boundary** (enforced by OPA at the bridge):
  - Accio may search, RFQ, follow up, negotiate within bounds, and normalize.
  - Only humans in DiscoverMake may:
    - release full design packages to unapproved suppliers
    - pay deposits
    - place POs
    - accept engineering substitutions or tolerance changes
    - approve tooling
    - start production
- Accio sits behind a `SourcingProvider` interface next to shop stock, catalog distributors and an internal sourcing desk. DiscoverMake keeps working if Accio's capabilities change.

## Consequences
- Accio effectively works as a 24/7 procurement department, and customers never see Alibaba.
- We depend on Accio Work's MCP client behavior and scheduling. Contract tests run against a recorded agent session, and the sourcing desk is the fallback.
- Confidential CAD is exposed only through signed, expiring, access-logged URLs, scoped by the approval policy.

## Implementation notes (R2, 2026-10-07)
- **Location.** The MCP server runs inside the web app at `POST /api/mcp/sourcing`, not as a separate `services/accio-bridge`. It uses stateless Streamable HTTP with JSON responses from `@modelcontextprotocol/sdk`. One deployable is enough until the call volume says otherwise. The code is in `src/server/sourcing/`.
- **Approval boundary.** The boundary is a TypeScript policy table (`src/server/sourcing/policy.ts`) with the same rules as above, and its unit tests prove every human-only action returns `APPROVAL_REQUIRED`. No tool exists for purchasing, paying, tooling, production, compliance, tolerance or material changes, or selecting the winning offer. The OPA sidecar arrives in R3, using the same rules table.
- **Trust.** An offer is `SUPPLIER_CONFIRMED` only when the supplier confirmed it against the job's exact `design_version` and it has no exceptions. Offers outside the negotiation bounds, or for a different quantity or MOQ, are stored but flagged and stay `SUPPLIER_ESTIMATE`. A buyer can only choose a supplier-confirmed offer, and ops confirms the choice.
- **Not in R2.** Turning a selected offer into a paid order with a supplier fulfilment leg is R3, together with the Delivery Promise and OR-Tools. Checkout still accepts BINDING quotes only.
