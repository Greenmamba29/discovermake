# 02 · Instant quote engine (the SendCutSend core)

This is release **R1 Cut**: upload a part, see a 3D preview and a price in seconds, pay, and receive real laser-cut, bent and finished parts. Everything else in DiscoverMake gets priced through this engine. Make AI designs, remixes from live, and drops all end up here.

## Customer flow

```
Upload (DXF / DWG / SVG / AI / STEP)
 → Units check ("Is this in mm or inches?" if ambiguous)
 → 3D preview (extruded to thickness; bends animated for STEP sheet parts)
 → Pick material + thickness            (DoorDash-style "Required · Select 1" groups)
 → Add services                         (bending, tapping, countersinks, hardware, finish)
 → DFM check                            (inline fixes, never a dead end)
 → Quantity → live price + ship date    (price ladder shows the quantity break)
 → Add to cart → checkout (workflow 04)
```

## Catalog (R1)

| Process | Materials (examples) | Notes |
|---|---|---|
| Fiber laser | Aluminum 5052/6061, mild steel, stainless 304/316, brass, copper, titanium | Thickness tables per material |
| CO₂ laser | Acrylic, plywood, hardwood veneer (walnut, maple), Delrin | Wood/acrylic require separate shops |
| Waterjet (R1.5) | Thick metals, G10, carbon fiber, stone | Partner-dependent |
| CNC routing (R1.5) | Hardwood, HDPE, aluminum plate | Feeds the walnut lamp base |
| Press brake bending | Sheet metals ≤ 6 mm | Requires STEP or bend lines |
| Secondary ops | Tapping, countersinking, PEM hardware insertion, deburring, dimple forming | Per-feature pricing |
| Finishing | Powder coat (color library), anodize (Type II), zinc plating, brushed | Per-area + batch setup |

The catalog lives in Postgres:
- `materials`
- `thickness_options`
- `processes`
- `services`
- `shop_capabilities`

Shops declare which SKUs they can run (workflow 05).

## Geometry pipeline (`services/quote-engine`, `services/cad-worker`)

1. **Parse.**
   - DXF: `ezdxf` (Python, MIT) in the worker, or `dxf-parser` (JS) for a quick client preview.
   - STEP: OpenCascade via CadQuery (Apache-2.0).
   - SVG/AI: convert to DXF.
2. **Clean.** Remove duplicate and overlapping lines, join near-closed contours (tolerance 0.01 mm), and reject open contours with a visual highlight.
3. **Features.** Extract:
   - outer contour
   - inner contours (holes and slots)
   - cut length
   - pierce count
   - bounding box
   - net and gross area
   - smallest feature
   - smallest hole
   - hole-to-edge distances
   - text (single-line fonts need bridges or are flagged)
4. **Sheet-metal unfolding** for STEP parts. Detect bends, compute the flat pattern using the K-factor table per material and thickness, and extract bend count, lengths and directions. FreeCAD's SheetMetal workbench is LGPL; run it isolated in the worker and log it in the copyleft ledger, or implement unfolding directly on OpenCascade.
5. **Preview.** Generate a GLB for the Three.js viewer and an SVG flat pattern with dimension callouts.

## DFM rules (deterministic, versioned)

| Rule | Typical threshold (per material table) | Fix offered |
|---|---|---|
| Min hole diameter | ≥ 1× thickness (steel), ≥ 0.75× (alu) | Enlarge hole / switch to drilled hole |
| Hole-to-edge | ≥ 1× thickness | Move hole |
| Min feature / web | ≥ 1× thickness | Widen web |
| Bend flange length | ≥ 4× thickness (tooling-dependent) | Extend flange |
| Hole-to-bend | ≥ 2.5× thickness + bend radius | Move hole / add relief |
| Bend relief | Required at corner bends | Auto-add relief |
| Part size | Within shop bed (e.g. 1500×3000 mm) and courier limits | Split part |
| Tapping | Hole matches tap drill for thread | Resize to tap drill |
| Text | Stencil font or bridges | Convert to stencil |

Rules are data (`dfm_rules`, with a `version`), not code branches. Every quote stores the rule-set version it ran against, so a re-quote is reproducible.

**Makeability score** = 100 − weighted violations − process-fit penalties. It shows as the ring in the UI. Blocking violations stop checkout. Warnings do not.

## Pricing model

```
unit_price =
    material      = nested_area × thickness × density × $/kg(material) × (1 + scrap%)
  + cutting       = (cut_length / feed_rate(material, thickness) + pierces × pierce_time) × laser_$/hr
  + bending       = bends × $/bend(thickness, length) + brake_setup / qty
  + secondary     = Σ(feature_count × $/feature)
  + finishing     = area × $/ft²(finish) + batch_setup(finish) / qty
  + handling      = part_handling + packaging(part_size)
  × (1 + platform_margin)
  → apply quantity curve (setup amortization + volume coefficient)
  → round to $0.01, floor at minimum order value
```

- **Nesting.** Estimate nested area with a fast bounding-box heuristic for the instant quote. Run true nesting (SVGnest/Deepnest-class algorithm; confirm licenses before embedding) at order time to lock shop cost.
- **Calibration.** Coefficients live per shop and are tuned weekly against invoices (NFR-2, ±8%). This is the job of the golden-part suite.
- **Price ladder.** Show unit price at 1 / 10 / 50 / 100 / 250 so customers see where quantity breaks are. This matches the Instant Quote screen (Prototype · Small Batch · Production Run).
- **Trust label.** Catalog parts priced by this engine against calibrated shop rate cards are **binding quotes**. Everything else carries its trust level from workflow 03: AI estimate, supplier estimate, or supplier-confirmed.
- **Shop-confirmed quotes.** Anything outside the catalog, or with low confidence, becomes `quote.status = REVIEW` with a 1-business-day SLA. It is never an instant price.

## Lead time

`ship_date = now + queue_wait(shop, process) + process_time(qty) + finishing_time + QA + packing`, then add the carrier transit for the delivery date. Queue wait comes from live shop capacity (workflow 05). The customer sees one date. The Delivery Promise engine (workflow 03) guarantees it.

## API (contracts in `contracts/quote.schema.ts`)

```
POST /api/parts                → { partId, uploadUrl }           (signed upload, virus scan, size cap)
POST /api/parts/:id/analyze    → { features, dfm, previewUrl }   (async job; websocket progress)
POST /api/quotes               → { quoteId, lines[], ladder[], shipDate, makeability, ruleVersion }
GET  /api/quotes/:id
```

Events: `part.uploaded`, `part.analyzed`, `dfm.completed`, `quote.created`, `quote.updated`.

## Security for uploads

- Signed URLs, 50 MB cap, and an extension and magic-byte check.
- Parse inside a sandboxed worker with no network, CPU and time limits, and AV scanning.
- Export-control and prohibited-item screen before quoting, with a human review queue.
- Uploaded designs are private by default. Creators publish explicitly (workflow 08).

## Acceptance (R1)

1. Upload a 2 MB DXF bracket and see a price and ship date in under 4 s at p95.
2. A DFM violation shows an inline fix. Applying the fix re-quotes.
3. Across the 50-part golden suite, quotes land within ±8% of shop invoices.
4. An order produces a signed job packet for the shop: DXF/STEP, material, thickness, ops, qty, QA notes, packing.
