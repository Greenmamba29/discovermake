# DiscoverMake CAD worker

The R2 CAD worker (EPIC-100-4). It takes a structured, bounded **CadSpec** and uses [CadQuery](https://github.com/CadQuery/cadquery) (Apache-2.0) to produce manufacturing artifacts:

| Family | Process | Artifacts |
|---|---|---|
| `sheet_panel` | Laser cutting | DXF flat pattern, STEP, GLB |
| `l_bracket` | Laser + press brake | DXF flat pattern with a `BEND_90` line (K-factor bend allowance), folded STEP, GLB |
| `enclosure` | 3D print / CNC | STEP assembly (base + lip lid), GLB |

**It never runs model-written code.** The Make AI CAD agent picks a family and fills in its parameters. The worker re-validates every bound with pydantic, rejects any unknown field, and runs each generation in a separate process with a hard timeout.

The spec is mirrored in `src/contracts/cad.ts` (zod). Change both files together; `tests/cad/cad-spec.test.ts` pins the shared bounds.

## Why the DXF output matters

Flat patterns follow the R1 quote-engine conventions (`src/server/quote/dxf/parse.ts`):
- millimetres (`$INSUNITS = 4`)
- cuts on layer `CUT`
- bends on `BEND_<angle>`

A generated part therefore goes straight into the instant quote engine and can come back as a **BINDING** quote, so Make AI → CAD → quote → checkout needs no human cleanup. `tests/cad/cad-worker-quote.test.ts` checks this against golden files in `tests/fixtures/cad/`.

Output is deterministic: the same spec produces the same bytes and the same sha256. To regenerate the golden files after changing the DXF writer:

```
python -m cad_worker.golden ../../tests/fixtures/cad
```

## API

```
GET  /healthz
POST /v1/generate     Authorization: Bearer $CAD_WORKER_TOKEN
     { "spec": CadSpec, "ref": "bld_x@v3" }
  -> { family, artifacts: [{kind, filename, content_type, bytes, sha256, content_base64}],
       metrics: {bbox_mm, volume_mm3, flat_size_mm?, bend_count?, flat_pattern?, part_count?},
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
pytest
CAD_WORKER_ALLOW_NO_AUTH=1 python -m cad_worker.app
```

Deploy with the `Dockerfile` to a container host (Fly.io, Render, Cloud Run). It does not fit Vercel functions: OpenCascade needs native libraries and more memory than a function gets.

## Licenses

- CadQuery: Apache-2.0
- ezdxf: MIT
- OCP / OpenCascade: LGPL-2.1 with exception. It is used as the unmodified upstream wheel in an isolated service, per the copyleft rule in `docs/architecture/open-source-register.md`.
