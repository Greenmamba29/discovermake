# Text to CAD (cadgen): "Make it in 3D" and Kids & Family templates

Contract: `src/contracts/text-to-cad.ts` (worker) and `src/contracts/make-it-3d.ts` (web API).

## Engine

[cadgen](https://github.com/earthtojake/text-to-cad) **0.7.20** (commit `b48ff49`, MIT, Copyright 2026 Thompson Labs LLC), a build123d / Open CASCADE runtime. A model is a plain Python script: one parameterless function decorated with `@step` / `@glb` / `@stl`, returning a build123d shape, run as `python model.py --json`. cadgen writes STEP itself and exports meshes (GLB, STL) through Node.

It runs only in the CAD worker (`services/cad-worker`), never in the web app.

### Why a separate virtualenv

cadgen installs `cadquery-ocp-novtk`, which replaces the `cadquery-ocp` wheel that the worker's CadQuery families need (same `OCP` module, different build). Sharing one environment breaks one of the two. So cadgen lives in its own venv (Docker: `/opt/cadgen`, pinned `cadgen==0.7.20`) and the worker starts it as a subprocess through `CADGEN_PYTHON`. Node 22 (`CADGEN_NODE`) does the mesh export.

## Two inputs

| | Make AI "Make it in 3D" (adult buyers) | Kids & Family templates |
|---|---|---|
| Who writes the model | Make AI (Gemini, `src/server/make-ai`), from the buyer's description | Us: `services/cad-worker/cad_worker/text_to_cad/templates/` (name keychain, phone stand, bookmark, desk tidy, bike hook) |
| Trust | **Untrusted code**: static gate, then sandbox | Trusted code, still sandboxed |
| Input | Free text (2,000 chars), never shown to the model as instructions | Bounded options validated twice (zod in the app, pydantic in the worker); labels are letters, digits and spaces only; passed as `params.json` data, never pasted into code |
| Worker route | `POST /v1/text-to-cad/build` | `POST /v1/kid-templates/{template}/build` |

Nothing typed in Kids mode is ever sent to Make AI: kids choose a template and options. `makeIn3D` also refuses a build whose root node says `audience: 'kids'`.

## Data flow (Make it in 3D)

```
buyer: "a desk cable holder with three slots"            (Build Workspace Object View, or /make/ai)
  -> POST /api/builds/:id/text-to-cad {prompt}            owner only (assertCanEditBuild), shared rate limiter
  -> Make AI writes a cadgen script                        instructions = guide/PREAMBLE.md + vendored cadgen skill docs
  -> buildFromScript (src/server/cad/text-to-cad.ts)       bearer token, timeout, capped response, zod, sha256 per artifact
  -> worker: gate.py (AST) -> runner.py (sandbox) -> measure.py (our STEP check)
       BUILD_FAILED -> the plain error goes back to Make AI, at most 2 repairs
  -> STEP / GLB / STL + the script stored at builds/<id>/cad/v<N>/
  -> NEW DRAFT design version: part:main.data.textToCad = {prompt, engine, scriptSha256, geometry, minWallMm, artifacts, attempts, model, ...}
  -> Object View shows it (GLB, measured size, downloads)
  -> buyer approves the version (existing approve route)
  -> POST /api/builds/:id/text-to-cad/quote {printMaterialSlug, quantity}
       STL sha256 re-checked -> READY printed part -> createPrintQuote (worker geometry, wall measured on the mesh)
       -> BINDING quote when a partner printer fits and print DFM passes -> /checkout/:quoteId
```

The print DFM needs a minimum wall. A generated model has no spec that declares it, so `src/server/text-to-cad/mesh.ts` measures it on the STL: rays from area-weighted surface samples go into the material and the distance to the far side is the local thickness; the 2nd percentile is the reported wall (the golden part measures 4.36 mm; its true floor is 4.0 mm). Bridge span is reported as 0 (not measured).

Without `GOOGLE_GENERATIVE_AI_API_KEY`, `MAKE_AI_ENABLED` or `CAD_WORKER_URL`, every surface shows an honest unavailable state (the same pattern as Ask Make AI) and nothing is written.

## The gate (`gate.py`, runs before anything executes)

- Imports: only `from __future__ import annotations`, `math`, `typing`, and `from cadgen import step, glb, stl, build123d [as bd]`.
- Forbidden builtins: `open exec eval compile __import__ globals locals vars getattr setattr delattr hasattr input breakpoint help dir exit quit memoryview`.
- Every name and attribute starting with `_` (a lone `_` loop variable is allowed; `__name__` only in the guard).
- Frame, generator and code attributes (`gi_frame`, `f_globals`, `tb_frame`, `co_*`, ...), `.format` / `.format_map` (they read attributes by name), and file-ish attributes (`read`, `write`, `save`, `load`, `glob`, `environ`, ...).
- build123d through `bd.` only for names in a static allow-list (build123d 0.11.1's `__all__` minus import/export, font and encoder machinery: `bd_names.py`); `font_path` and a fourth positional `Text` argument are rejected.
- Classes, async, `global`/`nonlocal`, `yield`, `with open(...)`.
- Exactly one decorated, parameterless model function; decorators only `@step/@glb/@stl`, each once, `out=` a bare filename with the right extension (no `/`, `\`, `..`, `:` or absolute path), only numeric mesh tolerances besides; module level only imports, constants, functions, a docstring and `if __name__ == "__main__": model()`.
- Size cap 64 KB (`TEXT_TO_CAD_MAX_SCRIPT_BYTES`). Violations come back as `GATE_REJECTED` with `{line, rule}`.

A syntax error is reported as `BUILD_FAILED` (nothing unsafe ran; Make AI can repair it).

## Sandbox layers (`runner.py`)

1. **Fresh job folder** per build (`tempfile.mkdtemp`): the model runs with `cwd=<root>/job`; `HOME`, `TMPDIR`, `CADGEN_CACHE_DIR`, `CADGEN_STATE_DIR` point inside `<root>/home`. Deleted afterwards. No cache, store or daemon is shared between jobs.
2. **Empty environment** (`env -i` style): `PATH=/usr/local/bin:/usr/bin:/bin` plus `CADGEN_DAEMON=0` (no persistent build daemon under `/tmp/cadgen-daemon`), `CADGEN_TELEMETRY=0` and `DO_NOT_TRACK=1` (cadgen sends PostHog telemetry by default), `CADGEN_UPDATE_CHECK=0`, `CADGEN_NODE`. No worker secret is inherited (a test spies on the spawned env).
3. **`python -I`**: no user site-packages, no `PYTHON*` variables, the script's folder is not on `sys.path`.
4. **Resource limits** set in the child before exec: CPU seconds (timeout + 10), address space 3 GB (verified with Node's mesh export), file size 64 MB, 512 open files, no core dumps; its own session, so a timeout (`CADGEN_TIMEOUT_S`, default 120 s) kills the whole process group, Node included.
5. **Network**: `unshare --net --map-root-user` (an empty network namespace) when the kernel allows unprivileged user namespaces; otherwise the worker logs once that the container's network policy must provide it.
6. **Our own measurement**: `measure.py` (not the submitted script) reads the STEP with `cadgen.read_step` in the same sandbox and reports bbox, volume, area, solid count and `cadgen.geometry.is_sound`.
7. **Outputs** capped at 20 MB each; the app re-verifies size and sha256 of every artifact. Errors map to the contract codes with plain words: no stack trace or server path ever leaves the worker (paths are stripped from error text).

### What production must add

- Run the worker in a container with **no outbound network** (egress-deny network policy), ideally under **gVisor** (`runsc`) or Firecracker, since unprivileged `unshare` is often disabled in managed container runtimes.
- A container memory limit (>= 4 GB per concurrent text-to-CAD build; `TEXT_TO_CAD_CONCURRENCY` defaults to 1), a PID limit, a read-only root filesystem with a writable `/tmp`, and the non-root `cad` user (already in the Dockerfile).
- Keep the worker private (bearer `CAD_WORKER_TOKEN`, no public ingress besides the app).
- Telemetry stays off: the env above is set per build, and the Dockerfile also sets `CADGEN_TELEMETRY=0 DO_NOT_TRACK=1 CADGEN_DAEMON=0 CADGEN_UPDATE_CHECK=0` for the image.

## Failure modes

| Code | Cause | Buyer sees |
|---|---|---|
| `GATE_REJECTED` | The script used something not allowed; nothing ran | "Make AI couldn't build that safely. Try describing it another way." |
| `BUILD_FAILED` | The model raised, made no solid, or missed an output (after 2 repairs) | "Make AI couldn't turn that into a solid shape...", plus the worker's plain last error |
| `TIMEOUT` | Over `CADGEN_TIMEOUT_S` or the CPU limit | "Building the 3D model took too long. Try a simpler shape." |
| `TOO_LARGE` | An output over 20 MB (or the file-size limit) | "That model came out too detailed..." |
| `UNAVAILABLE` | No `CADGEN_PYTHON` on the worker, or Make AI / the worker not configured | The honest unavailable state |
| `NETWORK` (app only) | The worker is unreachable or answered badly (wrong shape, checksum) | "The 3D model service could not be reached..." |

A model that is not one sound solid is stored with a warning and cannot be quoted (409). A draft version cannot be quoted (409).

## Licenses

| Component | License | How it is used |
|---|---|---|
| cadgen 0.7.20 (earthtojake/text-to-cad) | MIT | Unmodified, in its own venv in the worker; its cad skill docs are vendored verbatim with the LICENSE in `src/server/text-to-cad/guide/` |
| build123d 0.11.1 | Apache-2.0 | Installed by cadgen |
| OCP / Open CASCADE (`cadquery-ocp-novtk`) | LGPL-2.1 (with the OCCT exception) | The unmodified upstream wheel, in an isolated service (see `open-source-register.md`) |
| Node.js 22 | MIT | Mesh export runtime in the worker image |
| DejaVu Sans Bold (subset: letters, digits, space) | Bitstream Vera license (DejaVu changes public domain) | Kid template labels; license next to the font |

All are listed in `THIRD_PARTY_NOTICES.md`.

## Tests

- Worker: `tests/test_text_to_cad_gate.py` (accept/reject cases, lines), `tests/test_text_to_cad_runner.py` (env spy: telemetry/daemon off and nothing inherited; gate-before-run; a real step/glb/stl build with exact geometry; plain failures; timeout; every template within its size bounds; routes). Real builds skip without `CADGEN_PYTHON`.
- App: `tests/cad/text-to-cad-client.test.ts` (fake worker), `tests/text-to-cad/*.test.ts` (mesh wall, the repair loop, approval before a BINDING quote, Kids guard, owner-only routes), `src/components/workspace/make-it-3d-panel.test.tsx`.
- E2E: `tests/e2e/text-to-cad-journey.spec.ts` at 390 and 1280 px. The seam (`tests/e2e/support/text-to-cad.ts`) plants the golden cadgen output in `tests/fixtures/text-to-cad/`, generated with `python -m cad_worker.text_to_cad.golden` through the real gate and sandbox.
