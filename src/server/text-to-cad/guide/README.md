# Make AI "Make it in 3D": model-writing guide

These files are the instructions Make AI follows when it writes a cadgen model script for a buyer's
description (`src/server/text-to-cad/generate.ts` reads them at runtime).

| File | Source |
|---|---|
| `PREAMBLE.md` | DiscoverMake. The rules our worker enforces (allowed imports, bare-filename outputs, one solid, mm, printable). It is read first and wins where the upstream docs describe a workflow we do not run (CLI commands, snapshots, the viewer, project folders, `../STEP/` output paths). |
| `SKILL.md` | `skills/cad/SKILL.md` |
| `references/build123d-modeling.md` | `skills/cad/references/build123d-modeling.md` |
| `references/step-generation.md` | `skills/cad/references/step-generation.md` |
| `references/supported-exports.md` | `skills/cad/references/supported-exports.md` |
| `LICENSE` | `LICENSE` (MIT, Copyright (c) 2026 Thompson Labs LLC) |

Upstream: [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad), release **0.7.20**,
commit **b48ff49** ("Release 0.7.20 (#600)"), MIT License. The four upstream files are copied verbatim
(nothing trimmed or edited). When the worker's cadgen pin changes (`services/cad-worker/Dockerfile`),
copy the same files from that release and update this table and `TEXT_TO_CAD_GUIDE_VERSION`.
