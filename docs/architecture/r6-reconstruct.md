# R6 "Reconstruct": fix anything from a photo

**Status (2026-10-09):** Stage 5 increment 1. The manual-assisted path is complete end to end:
photo → scale from a reference object → photo estimates → **caliper confirmation** → planner →
CAD worker → BINDING 3D-print quote → the existing checkout, order, dispatch and passport.
The GPU pipeline (SAM 2 → OpenCV → COLMAP / Open3D) sits behind an optional worker interface
that is off unless `RECONSTRUCT_WORKER_URL` is set.

**G3 demo** (`tests/e2e/reconstruct-journey.spec.ts`, 390 px and 1280 px): a photo of a broken
knob → credit-card scale → measure the diameter → confirm two caliper readings → Generate →
BINDING print quote → checkout (dev payment) → the order exists and the partner shop sees a
3D-print job with the STL.

## Flow

```
/reconstruct                      capture: 1-6 photos (rear camera on phones), part type, note,
  ?passport=pps_…                 optional passport link (material / process from its PUBLIC snapshot)
   │ POST /api/reconstruct        build (origin 'reconstruct') + graph v1 + reconstruct_sessions row
   │ attachments routes           each photo: signed PUT → size + magic-byte check → sha256
   ▼
/reconstruct/:id?step=measure     mark the reference, draw lines → ESTIMATES (session row only)
   │ PUT  …/measurements
   ▼
/reconstruct/:id?step=confirm     choices (shaft, flutes, flange, bracket shape) + caliper table
   │ POST …/dimensions            caliper readings → new design version with dim:* nodes
   │ POST …/generate              planner (caliper only) → approve → CAD worker → print quote
   ▼                              (503 "CAD service unavailable" without CAD_WORKER_URL)
/reconstruct/:id?step=review      Object View (GLB), photos with overlays, estimate vs caliper,
   │ POST …/quote                 print quote card (material, qty, ladder) → /checkout/:quoteId
   ▼
checkout → order → dispatch to a printer (STL job packet) → QA on the caliper dimensions → passport
```

Code:

| Area | Code |
|---|---|
| Contracts | `src/contracts/reconstruct.ts` (part types, options, required dimensions, presets, views, GPU contract), `src/contracts/cad.ts` (`RoundKnobSpec`, `SpacerBushingSpec`, `STL`) |
| Measurement math (pure, client + server) | `src/lib/reconstruct/measure.ts` |
| Server | `src/server/reconstruct/{sessions,dimensions,planner,segmentation,request}.ts` |
| Print quote engine | `src/server/quote/printing/{catalog,pricing,dfm,quotes,index}.ts` |
| Dispatch for printers | `src/server/dispatch/print.ts` (wired into `dispatchOrder`) |
| UI | `src/components/reconstruct/*`, `src/app/(app)/reconstruct/**` |
| CAD worker | `services/cad-worker/cad_worker/printed.py` (+ `specs.py`, `outputs.py`, `common.py`) |
| API | `src/app/api/reconstruct/**` |

## The confirmation rule (the hard rule)

1. Every critical dimension the chosen family needs (`requiredDimensions(partType, options)`)
   must be a **caliper or ruler reading the buyer typed** (mm or in; normalized to mm at 0.01 mm).
2. A photo estimate may prefill the field ("Use estimate as a start"), but the row stays
   **Not confirmed** until the buyer presses Confirm. The difference to the estimate is shown,
   with a warning above **10 %**.
3. **Nothing is inferred into CAD.** The planner returns `needs_input` (and Generate stays locked
   in the UI) until every critical dimension is confirmed; the server refuses too.
4. In the Build Graph every dimension is a REQUIREMENT node `dim:<param>`:
   - confirmed: `source: 'user'`, `data.requirementSource: 'user'`, `data.source: 'caliper'`,
     `valueMm`, `enteredValue` / `enteredUnit`, `confirmedAt`, plus `photoEstimateMm` and `deltaPct`;
   - estimate only: `source: 'system'`, `data.source: 'photo_estimate'`, `confirmedAt: null`.

   Only caliper readings are buyer-stated, so the existing CAD agent rule ("only buyer-stated
   numbers, 0.5 mm trace") applies unchanged to a Reconstruct build.
5. The planner (`planReconstruction`) builds the spec from confirmed readings only and records
   where every number came from (`trace`): `caliper`, `caliper_derived` (D-flat depth = shaft −
   across-the-flat; hole positions from the measured spacing), `standard` (a shaft standard the
   buyer picked, e.g. "6 mm D-shaft, 4.5 mm across the flat"), `buyer_choice` (flute count,
   pointer notch) and `design_rule` (knob bore = height − 2 mm cap, bend radius = thickness, fit
   clearance, chamfers: manufacturing choices, never sizes of the old part). Every `caliper`
   value is re-checked against the confirmed readings with the CAD agent's 0.5 mm tolerance.

## Measurement math

Single-plane (orthographic) model, `src/lib/reconstruct/measure.ts`:

- scale `mm/px = reference length / reference segment (px)`; presets: credit card long edge
  **85.60 mm** (short edge 53.98 mm, ISO/IEC 7810 ID-1), **US quarter Ø 24.26 mm**, or a ruler
  segment whose length the buyer types. A reference under 20 px is refused.
- estimate `L_px × mm/px`, rounded to 0.01 mm; click uncertainty
  `± mm/px · e·√2 · (1 + L/R)` with e = 2 px endpoint error, L the line and R the reference in px.
- **Perspective caveat** (shown on the tool): only right in the reference's plane with the camera
  square on; tilt, lens distortion and depth (a knob is taller than a card) can be 10 %+ off.
  That is why the caliper rule exists. Homography / multi-view correction is the GPU worker's job.
- Input: tap two points (touch / mouse), drag handles, or focus a handle and use the arrow keys
  (1 px, Shift 10 px); every line's estimate is an editable number (moves its end point).

## Reconstruction families (CAD worker 0.3.0)

| Family | Critical (caliper) | From choices / standards | Output |
|---|---|---|---|
| `round_knob` | outer Ø, height (+ shaft Ø and across-the-flat when measured; + engagement depth when measured) | shaft standard, D or round bore, flute count, pointer notch; bore depth = height − 2 mm unless measured | STEP, binary STL (mm), GLB, BOM, drawing, manifest |
| `spacer_bushing` | OD, ID, length (+ flange Ø and thickness) | flanged or plain | same |
| simple bracket replacement (planner) | flat: length, width, thickness (+ hole Ø and spacing); L: legs A/B, width, thickness; Z: flange, web, flange, width, thickness | shape, two centred holes | maps to `sheet_panel` / `slotted_plate`, `l_bracket`, `multi_bend_bracket`: DXF flat pattern → R1 laser quote on `/parts/:partId` |

Printed parts are modelled in print orientation (bore / flange down) and report `min_wall_mm`
and `bridge_span_mm`. The worker refuses walls under 0.8 mm (unbuildable); the print DFM blocks
under 1.2 mm. Every manifest (all families) now carries `metrics`: `bbox_mm`, `volume_mm3`,
`surface_area_mm2` (+ the two printed metrics). Goldens: `tests/fixtures/cad/reconstruct-{knob,spacer}`
(`python -m cad_worker.golden`).

## 3D-print quote model (`src/server/quote/printing`)

Catalog (`print_materials`, uncalibrated, USD): PLA 1240 kg/m³ $25/kg · PETG 1270 $28/kg · ASA
1070 $35/kg · Nylon PA12 (SLS) 1010 $90/kg. Partner model (same shape as the sheet catalog):
`shop_print_capabilities` (shop × material with the printer build volume, capability `3D_PRINT`)
and `shop_print_rate_cards` (one active per shop). The dev partner has an FDM farm
(6 × 250 × 210 × 220 mm) and one SLS printer (165 × 165 × 300 mm).

```
V_eff     = shell + infill × (V − shell),  shell = min(V, area × 1.2 mm)     (SLS: V_eff = V)
mass      = V_eff × density
material  = mass × $/kg × (1 + 10 % waste) × 1.15 markup
printing  = (V_eff / 10 800 mm³·h⁻¹ + ⌈z / 0.2 mm⌉ × 4 s) × $3/h            (SLS: 30 000 mm³/h, $12/h)
+ post-processing $1.50/part + QA $0.50/part + handling $0.30/part + packaging $3/order + setup $8/order
margin    = 35 % × (1 − 0.5 × f(qty)), never below 15 %   (f = the R1 volume curve)
floor     = $19 minimum order
```

- Volume discounts come out of the **margin only**: the shop is paid the full cost at every
  quantity, so a print quote is never below cost (`shopCost ≥ cost`, `platformFee ≥ 0`).
- Ladder **1 / 10 / 25 / 50 / 100**. Lead time: the R1 business-day model, printer hours spread
  over the capability's printers at 20 unattended hours per day.
- **BINDING only when** (a) the part's bounding box fits an active partner printer's build volume
  (any axis-aligned orientation), (b) that partner is ACTIVE with an active `3D_PRINT` capability
  for the material, an active print rate card and an active shop rate card, and (c) print DFM
  passes (every wall ≥ 1.2 mm; bridges over the material limit and tall parts are notes).
  Otherwise REVIEW (no printer fits / no capability) or NEEDS_INPUT (thin wall), never orderable.
- The quote is the **same immutable `quotes` row** the R1 engine writes, with
  `config.process = 'print'` (absent = sheet), `config.materialId = mat_print_*`,
  `config.thicknessOptionId = thk_print_*` (the layer profile), `quotes.rate_card_id` = the shop's
  commercial card of record, and `print_quote_details` (print rate card, capability, manifest
  geometry, STL sha256, the buyer's caliper dimensions). `POST /api/quotes` refuses print configs.
- Downstream, minimal branches: checkout re-checks the print rate card; dispatch matches printers
  and signs a packet with `print` and the STL (`files[].kind = 'SOURCE_STL'`), whose QA checks are
  the **caliper dimensions** (±0.3 mm or 0.6 %); the passport reads the layer profile; the Shop
  Console shows a "3D print" packet row. Prime's supplier route is untouched (`routeKind: 'shop'`).

**Calibration (owner inputs):** print-farm invoices for 20+ printed parts per material to fit
deposition rate, per-layer overhead, waste and post-processing; the partner's real build volumes
and printer counts; a reconstruction accuracy target per category (knobs ±0.3 mm on Ø).

## Optional GPU worker contract (`RECONSTRUCT_WORKER_URL`)

Client: `src/server/reconstruct/segmentation.ts` (Bearer `RECONSTRUCT_WORKER_TOKEN`, 20 s / 30 s
timeouts, 15 MB image cap out, 2 MB response cap back, zod-parsed). App route:
`POST /api/reconstruct/:buildId/segment { attachmentId }` (owner only, 6/min per IP). The UI shows
"Auto-detect" only when it is configured; suggestions are displayed as estimates and never confirm
anything.

```
POST /v1/segment   { image_base64, content_type, hint? }
  -> { polygons: [{ label, score 0..1, points: [{x,y}] (image px, 3..2000) }] (≤20),
       reference: { preset: credit_card | credit_card_short | us_quarter | ruler, a, b } | null,
       model }
POST /v1/measure   { image_base64, content_type, polygons, reference }
  -> { suggestions: [{ param (DimensionParam), valueMm, uncertaintyMm, method }] (≤20), model }
```

Intended pipeline on a GPU host: **SAM 2** masks the part and the reference object (prompted by
the hint / centre point) → **OpenCV**: reference corners → homography to the reference plane,
`minEnclosingCircle` / `minAreaRect` / Hough circles on the rectified mask → mm per feature with
an uncertainty → for multi-photo or video, **COLMAP** (SfM, scale from the reference) +
**Open3D** (mesh, plane / cylinder fits) for heights and depths. Outputs only ever prefill.

## API, events, limits, schema

- `POST /api/reconstruct`, `GET|PATCH /api/reconstruct/:id`, `PUT …/measurements`,
  `POST …/dimensions`, `POST …/generate`, `POST …/quote`, `POST …/segment`. Writes go through
  `assertCanEditBuild` (owner or the guest device; others 403); the view is open to the
  unguessable id with `canEdit`.
- Rate limits (shared `RateLimiter`, Postgres in production): session writes 60/min per IP,
  generate + quote 10/min, segment 6/min (plus fleet budgets); photos use the attachment limiter.
- Events: `reconstruct.started`, `reconstruct.dimension_confirmed`, `reconstruct.cad_generated`
  (plus the usual `build.created`, `design.version_*`, `cad.generated`, `quote.created`).
- Schema (`// R6 Reconstruct` at the end of `schema.ts`; local migration `0009_r6_reconstruct`,
  to be regenerated on integration): `print_materials`, `shop_print_capabilities`,
  `shop_print_rate_cards`, `print_quote_details`, `reconstruct_sessions`, build origin `reconstruct`.
- Env: `RECONSTRUCT_WORKER_URL`, `RECONSTRUCT_WORKER_TOKEN` (optional). Generation still needs
  `CAD_WORKER_URL` / `CAD_WORKER_TOKEN`.

## Tests

- pytest `services/cad-worker/tests/test_reconstruct.py`: bounds, closed-form volume and area,
  binary STL closed-mesh volume, manifest metrics, determinism, goldens.
- vitest `tests/reconstruct/*`: measurement math and units, planner traces only caliper numbers,
  graph nodes, print pricing (ladder, never below cost, minimum, SLS) and BINDING conditions
  (fit, capability, DFM, rate card), segmentation client (disabled / enabled / errors / caps), the
  full flow through checkout to an STL printer job, ownership (403). `tests/cad/cad-printed-spec.test.ts`
  pins the TS mirror. Component tests: `measure-tool.test.tsx`, `confirm-table.test.tsx`.
- e2e: `reconstruct-journey.spec.ts` and four page-sweep screens (capture, measure, confirm, review).
  The e2e seam (`tests/e2e/support/reconstruct.ts`) plants the worker's golden output only after
  checking the app's own plan equals the golden spec; the price is never faked.

## Deferred

- GPU worker deployment (SAM 2 / COLMAP / Open3D) and multi-photo or video reconstruction.
- More families (lever handles, clips, hinges, caps with threads) and organic shapes.
- Calibrated print coefficients (golden printed-part suite) and per-category accuracy targets.
- Passport "Order a replacement" for printed parts (the one-tap replacement still uses the sheet
  engine); printed parts go through Reconstruct ("Broken? Rebuild it from a photo"). My Builds
  "Reorder" of a printed part does re-quote on the print engine (`printing/reorder.ts`).
- Per-material support / orientation optimisation (parts print as modelled).
