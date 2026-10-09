# DiscoverMake CAD worker

The R2 CAD worker (EPIC-100-4). It takes a structured, bounded **CadSpec** and uses [CadQuery](https://github.com/CadQuery/cadquery) (Apache-2.0) to produce manufacturing artifacts:

| Family | Process | Artifacts |
|---|---|---|
| `sheet_panel` | Laser cutting | DXF flat pattern, STEP, GLB |
| `l_bracket` | Laser + press brake | DXF flat pattern with a `BEND_90` line (K-factor bend allowance), folded STEP, GLB |
| `enclosure` | 3D print / CNC | STEP assembly (base + lip lid), GLB |
| `u_channel` | Laser + press brake | DXF with two `BEND_90_UP` lines, folded STEP, GLB |
| `multi_bend_bracket` | Laser + press brake | Z / hat / open profiles (1-4 bends of +90 / -90): DXF with `BEND_90_UP` / `BEND_90_DOWN` lines, folded STEP, GLB |
| `slotted_plate` | Laser (+ countersinking) | DXF with round holes, obround slots and countersink through-holes; STEP/GLB with the countersink cones |
| `sheet_enclosure` | Laser + press brake + hardware | One DXF per panel (body, end cap(s), lid), STEP assembly, GLB; rivet / screw holes aligned across panels |
| `round_knob` (R6) | 3D print | Knob body (Ø x height), D-shaft or round blind bore with fit clearance, optional grip flutes, pointer notch, top chamfer: STEP, binary STL (mm), GLB |
| `spacer_bushing` (R6) | 3D print | Plain or flanged spacer / bushing (OD / ID / length, flange Ø x thickness): STEP, binary STL (mm), GLB |

The R6 printed families are modelled in their print orientation (bore / flange down on the bed) and report `min_wall_mm` and `bridge_span_mm`. The worker refuses walls under 0.8 mm (unbuildable); the print quote engine's DFM (`src/server/quote/printing`) blocks under 1.2 mm. Every product-defining number comes from a buyer caliper reading or a shaft standard the buyer picked (the web app's Reconstruct planner, see `docs/architecture/r6-reconstruct.md`).

Every result also carries four documents: `bom.json` and `bom.csv` (fabricated panels or parts plus purchased hardware), `drawing.svg` (each flat pattern with overall dimensions and dashed bend lines, or the printed part's top and side views, plus the hardware list), and `manifest.json` (the spec, worker version, the sha256 + size of every other artifact, and `metrics`: `bbox_mm`, `volume_mm3`, `surface_area_mm2`, plus `min_wall_mm` / `bridge_span_mm` for printed parts).

### Sheet-metal conventions (all bent families)

- Flange lengths are OUTSIDE dimensions. Every bend is 90 degrees, so each bend takes `r + t` (setback) off its flanges, and the flat pattern adds a bend allowance of `(pi / 2) * (r + k * t)`.
- The flat flange from a bend line to a free edge must be at least 4 x thickness. That mirrors the R1 DFM `bend_flange_min`, so generated parts never trip it.
- Every hole keeps at least one thickness from the part edges, bend zones and its neighbouring features.
- Holes on bent parts are `{flange, x_mm, y_mm, diameter_mm}`:
  - `x` runs across the width, along the bend lines;
  - `y` runs along the flange from that flange's start outer face (for the first flange, its free edge).
- Countersinks are not written as a DXF layer. The R1 parser cuts every layer that is not an annotation layer, so a `COUNTERSINK` layer would be cut. The DXF cuts the through-diameter, and the cone is in STEP/GLB, `metrics.countersinks` and the BOM notes.

**It never runs model-written code.** The Make AI CAD agent picks a family and fills in its parameters. The worker re-validates every bound with pydantic, rejects any unknown field, and runs each generation in a separate process with a hard timeout.

The spec is mirrored in `src/contracts/cad.ts` (zod). Change both files together; `tests/cad/cad-spec.test.ts` pins the shared bounds.

## Why the DXF output matters

Flat patterns follow the R1 quote-engine conventions (`src/server/quote/dxf/parse.ts`):
- millimetres (`$INSUNITS = 4`)
- cuts on layer `CUT`
- bends on `BEND_<angle>`

A generated part therefore goes straight into the instant quote engine and can come back as a **BINDING** quote, so Make AI → CAD → quote → checkout needs no human cleanup. `tests/cad/cad-worker-quote.test.ts` checks this against golden files in `tests/fixtures/cad/`.

Output is reproducible: the same spec produces the same DXF, STEP, BOM, drawing and manifest bytes in any process. ezdxf's CLASS order and OCCT's STEP timestamp are pinned in `common.py`. To regenerate every golden file (flat patterns per family, the workflow 01 acceptance fixture, and the eval goldens in `evals/cad/golden`) after changing a family or the DXF writer:

```
python -m cad_worker.golden
```

## API

```
GET  /healthz
POST /v1/generate     Authorization: Bearer $CAD_WORKER_TOKEN
     { "spec": CadSpec, "ref": "bld_x@v3" }
  -> { family, artifacts: [{kind, filename, content_type, bytes, sha256, content_base64}],
       metrics: {bbox_mm, volume_mm3, surface_area_mm2, min_wall_mm?, flat_size_mm?, bend_count?, flat_pattern?, part_count?, panels?, bom_item_count},
       processes, warnings, ref, duration_ms, worker_version }
```

Errors:

| Status | Code |
|---|---|
| 401 | Missing or invalid bearer token |
| 413 | Spec body over 64 KB |
| 422 | `VALIDATION_FAILED` (invalid spec) or `GEOMETRY_FAILED` (kernel error) |
| 504 | `TIMEOUT` |

## Configuration

| Variable | Default | |
|---|---|---|
| `CAD_WORKER_TOKEN` | — | Required. Set `CAD_WORKER_ALLOW_NO_AUTH=1` only for local development |
| `CAD_WORKER_TIMEOUT_S` | 30 | Per-request generation timeout |
| `CAD_WORKER_CONCURRENCY` | 2 | Parallel generations (each needs ~300 MB) |
| `PORT` | 8080 | |

The web app reads `CAD_WORKER_URL` and `CAD_WORKER_TOKEN` (see `src/server/cad/client.ts`).

## Run

```
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
python -m pytest -q        # families, bounds, documents, determinism, the workflow 01 enclosure
CAD_WORKER_ALLOW_NO_AUTH=1 python -m cad_worker.app
```

The web app's tests replay the recorded goldens, so they need no Python. When `CAD_WORKER_URL` points at a running worker, `tests/cad/workflow-01-acceptance.test.ts`, `tests/evals/cad-evals.test.ts` and `bun run eval:cad` use the live worker instead.

Artifact kinds: `STEP`, `DXF`, `GLB`, `STL` (printed families), `BOM` (`bom.json`), `CSV` (`bom.csv`), `SVG` (`drawing.svg`) and `MANIFEST` (`manifest.json`, always last).

Deploy with the `Dockerfile` to a container host (Fly.io, Render, Cloud Run). It does not fit Vercel functions: OpenCascade needs native libraries and more memory than a function gets.

## Licenses

- CadQuery: Apache-2.0
- ezdxf: MIT
- OCP / OpenCascade: LGPL-2.1 with exception. It is used as the unmodified upstream wheel in an isolated service, per the copyleft rule in `docs/architecture/open-source-register.md`.
