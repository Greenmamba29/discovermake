# 05 · MAKE Network logistics (the Uber layer)

Uber matches a rider to the best nearby driver, shows the car moving on a map, and settles payment automatically. DiscoverMake does the same with **jobs and shops**. It matches a manufacturing job to the best capable shop, shows the job moving through machines and carriers, and settles the shop, the creator and the platform automatically.

## Actors

| Actor | App surface | Uber analogue |
|---|---|---|
| Buyer | Web/mobile app | Rider |
| Shop (fabricator, finisher, assembler) | **Shop Console** (web, tablet-friendly) | Driver app |
| Carrier | API (rates, labels, tracking webhooks) | — |
| DiscoverMake ops | Admin / dispatch board | Ops center |

## Shop onboarding

1. Apply: company details, location, photos, machines (make, model, bed size, max thickness per material), finishes, certifications (ISO 9001, AS9100), insurance.
2. Verification: a sample part order (DiscoverMake pays) measured against a QA checklist.
3. Capability record: `Facility` → `MachineCapability[]` → supported catalog SKUs. Rate cards feed the quote engine coefficients (workflow 02).
4. Payouts: Stripe Connect Express. The repo already has `api/payouts/connect`.
5. Optional: camera feeds for live (workflow 06), scoped per cell.

## Dispatch (matching)

```
job ready (materials reserved or on hand)
 → candidate shops = capability ∩ catalog SKU ∩ certification ∩ region rules
 → score = cost(shop rate card) + P90 queue time + quality score + distance to customer
          + shop-stock availability − load-balance penalty
 → offer to top shop (accept window: 2 business hours) → fallback to next
 → accepted → job packet released (signed URL, watermark, expiring)
```

- Solve with OR-Tools when batching multiple orders onto one sheet or run, which is where nesting savings come from.
- **Split routing** for multi-step jobs: cut (shop A) → powder coat (finisher B) → assembly (shop C). Each leg is a `ManufacturingJob` linked to the same Build. Inter-shop freight is booked automatically.

## Shop Console (R1 minimum)

- **Job inbox:** accept or decline with a reason.
- **Job packet:** files, material, ops, QA checklist, packing spec, label.
- **Milestone buttons:** Material staged → Cutting → Bending → Finishing → QA → Packed. Each tap emits `production.milestone`, and the buyer sees it Uber-style.
- **QA upload:** photos plus measurements against the inspection plan. A pass is required before a label prints.
- **Capacity calendar:** blocked days and queue depth. This feeds Promise.
- **Messaging:** with buyer or ops, using quick replies like Uber's "I'm here" ("Material arrived", "Need clarification on hole size").
- **Payouts and scorecard.**

Adapter levels per shop: **L0** email + portal (launch) → **L1** Shop Console → **L2** API/webhooks into their MES/ERP → **L3** machine telemetry (later; never LLM-to-machine, spec §29).

## Carriers and tracking

- Use a multi-carrier rate and label API (EasyPost or Shippo class). Rates, labels and tracking webhooks normalize into `Shipment` events.
- Freight for large or heavy items uses an LTL quote API, R2+.
- The buyer map uses the carrier scan events plus the shop location.

## Buyer tracking UX (Uber pattern)

- Bottom sheet over a map or 3D object: **"Cutting now · Ships Thu"**, with a progress bar of 4–6 segments.
- **Shop card:** shop name, rating, city and machine ("Fiber laser 04"), with Message and Watch buttons.
- **Activity tab** lists all orders with **Reorder** (Uber's Rebook) and **Remix**.
- **After delivery:** rate the build, tip the creator, and **Show us what you made** (UGC, workflow 07).

## Quality

- `InspectionPlan` is generated from DFM features: critical dimensions, flatness, finish.
- `InspectionResult` holds the shop's photos and measurements, plus optional third-party QA for production runs.
- Scorecards track on-time %, first-pass yield, defect rate, rework cost and response time. They feed dispatch scoring and shop tiering.

## Events

- `job.offered`
- `job.accepted`
- `job.declined`
- `production.started`
- `production.milestone`
- `inspection.passed`
- `inspection.failed`
- `shipment.created`
- `shipment.updated`
- `product.delivered`

## Acceptance (R1)

1. An order dispatches to a partner shop, the shop accepts in the console, and milestones appear in the buyer tracker within 5 s.
2. A QA fail blocks shipping and opens a rework job automatically.
3. Shop payout is created on delivery confirmation, minus platform fee.
