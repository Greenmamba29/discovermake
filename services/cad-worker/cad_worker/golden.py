"""Regenerate the golden flat patterns used by the web app's contract test.

    python -m cad_worker.golden ../../tests/fixtures/cad

``tests/cad/cad-worker-quote.test.ts`` feeds these files through the R1 quote
engine; regenerate them whenever the DXF writer changes and commit the result.
"""

from __future__ import annotations

import os
import sys

from .generate import generate
from .specs import GenerateRequest

GOLDEN = {
    "cad-worker-panel.dxf": {
        "family": "sheet_panel",
        "width_mm": 200,
        "height_mm": 100,
        "thickness_mm": 1.52,
        "corner_radius_mm": 5,
        "holes": [{"x_mm": 20, "y_mm": 20, "diameter_mm": 6}, {"x_mm": 180, "y_mm": 80, "diameter_mm": 6}],
    },
    "cad-worker-l-bracket.dxf": {
        "family": "l_bracket",
        "leg_a_mm": 50,
        "leg_b_mm": 80,
        "width_mm": 40,
        "thickness_mm": 1.52,
        "inside_bend_radius_mm": 1.52,
        "holes_a": [{"x_mm": 20, "y_mm": 15, "diameter_mm": 5}],
        "holes_b": [{"x_mm": 20, "y_mm": 20, "diameter_mm": 5}],
    },
}


def main(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    for name, spec in GOLDEN.items():
        result = generate(GenerateRequest(spec=spec).spec)
        dxf = next(a for a in result.artifacts if a.kind == "DXF")
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(dxf.data)
        print(f"wrote {name} ({len(dxf.data)} bytes)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../../tests/fixtures/cad")
