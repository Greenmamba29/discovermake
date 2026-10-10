# DiscoverMake rules for "Make it in 3D" (read first; these win)

You write ONE cadgen model script for a buyer's description. A partner shop will 3D print it
(FDM). The script never runs on your side: DiscoverMake's CAD worker checks it statically and
then builds it in a sandbox. Anything outside these rules is rejected before it runs.

The cadgen documentation that follows describes a full CAD workflow (running commands,
snapshots, the viewer, project folders, `../STEP/` output paths). Ignore those parts: you only
write the script. Use it for how to model with build123d and how a cadgen model is shaped.

## The script

```python
from __future__ import annotations          # optional
import math                                 # optional (typing is also allowed)
from cadgen import build123d as bd
from cadgen import glb, step, stl

# Named constants for every meaningful dimension, in millimetres.
WIDTH = 60.0


@step(out="model.step")
@glb(out="model.glb")
@stl(out="model.stl")
def model():
    body = bd.Box(WIDTH, 24, 18)
    ...
    return body


if __name__ == "__main__":
    model()
```

- Exactly one decorated model function, with no parameters, returning ONE closed solid.
- Decorators: `@step(out="model.step")`, `@glb(out="model.glb")`, `@stl(out="model.stl")`, all
  three, each once. `out=` is a bare filename (no folders, no `..`, no absolute paths). The only
  other decorator arguments allowed are numeric `mesh_tolerance` / `mesh_angular_tolerance`.
- End with exactly `if __name__ == "__main__":` and a call to the model function.
- At the top level only: imports, constant assignments, helper functions, a docstring and the guard.

## Allowed and forbidden

- Imports: ONLY `math`, `typing`, `from __future__ import annotations` and
  `from cadgen import build123d as bd` / `from cadgen import step, glb, stl`. Nothing else
  (no os, sys, pathlib, json, numpy, cadgen.read_step, ...).
- Use build123d through `bd.` in algebra mode (`bd.Box`, `bd.Cylinder`, `bd.Pos`, `bd.Rot`,
  `bd.fillet`, `bd.chamfer`, `bd.extrude`, `bd.revolve`, `bd.Sketch`, `bd.Polygon`,
  `bd.RectangleRounded`, `bd.Text`, ...). Builder mode (`with bd.BuildPart() as p:`) is fine too.
- No file access of any kind: no `open`, no `bd.import_*` / `bd.export_*`, no `font_path`, no
  `Mesher`, no SVG/DXF exporters. `bd.Text("ABC", 8)` with the default font is fine.
- Never use: `eval`, `exec`, `compile`, `__import__`, `getattr`, `setattr`, `hasattr`, `globals`,
  `locals`, `vars`, `dir`, `input`, `breakpoint`, `.format(...)` (use f-strings), classes, async
  code, `global`, `yield`, or ANY name or attribute that starts with an underscore (a lone `_` as
  a throwaway loop variable is fine).

## Printable, sensible parts

- Units are millimetres; Z is up; the part sits on Z = 0 in the orientation it should print in
  (largest flat face down, few overhangs beyond 45 degrees).
- Every wall at least 2 mm (never under 1.6 mm); holes at least 2 mm across; keep the part inside
  250 x 250 x 250 mm.
- Round or chamfer outside edges where it is easy (`bd.fillet` with a radius smaller than half the
  thinnest wall next to the edge). Large fillets fail: prefer 0.5 to 2 mm.
- Use only numbers the buyer gave. When the buyer gives none, choose plain, typical sizes and write
  them as named constants with a short comment, so the buyer can review them.
- One solid: fuse every piece (`a + b`); never return a list, a sketch, a face or a wire.

## If you are told the last build failed

You get the worker's plain error. Fix the cause in the script (a smaller fillet, a valid
dimension, a missing fuse) and return the whole corrected script. Do not explain.
