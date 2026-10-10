"""Write the text-to-CAD golden fixture the web app's e2e seam plants (no worker or model in e2e).

    CADGEN_PYTHON=... CADGEN_NODE=... python -m cad_worker.text_to_cad.golden

Builds GOLDEN_SCRIPT through the real gate + sandbox and writes, under
tests/fixtures/text-to-cad/ at the repo root: model.py (the script), model.step / model.glb /
model.stl, and response.json (the worker's TextToCadBuildResponse without the base64 bodies).
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from .runner import build_script

GOLDEN_PROMPT = "A desk cable holder: a rounded block with three slots for charging cables."

GOLDEN_SCRIPT = '''from cadgen import build123d as bd
from cadgen import glb, step, stl

LENGTH = 60.0
DEPTH = 24.0
HEIGHT = 18.0
SLOT_W = 6.0
SLOT_DEPTH = 11.0


@step(out="model.step")
@glb(out="model.glb", mesh_tolerance=0.004, mesh_angular_tolerance=0.4)
@stl(out="model.stl", mesh_tolerance=0.004, mesh_angular_tolerance=0.4)
def model():
    body = bd.Box(LENGTH, DEPTH, HEIGHT, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    body = bd.fillet(body.edges().filter_by(bd.Axis.Z), radius=5)
    for x in (-18.0, 0.0, 18.0):
        slot = bd.Pos(x, 0, HEIGHT - SLOT_DEPTH) * bd.Box(SLOT_W, DEPTH + 2, SLOT_DEPTH + 1, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        rounded = bd.Pos(x, 0, HEIGHT - SLOT_DEPTH) * bd.Rot(90, 0, 0) * bd.Cylinder(SLOT_W / 2, DEPTH + 2)
        body = body - slot - rounded
    body = bd.fillet(body.edges().group_by(bd.Axis.Z)[-1], radius=1)
    return body


if __name__ == "__main__":
    model()
'''


def main() -> int:
    out = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "text-to-cad"
    result = build_script(GOLDEN_SCRIPT, ["step", "glb", "stl"])
    if not result.get("ok"):
        print(json.dumps(result), file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    (out / "model.py").write_text(GOLDEN_SCRIPT, "utf-8")
    meta = dict(result)
    meta["artifacts"] = []
    for a in result["artifacts"]:
        (out / a["filename"]).write_bytes(base64.b64decode(a["content_base64"]))
        meta["artifacts"].append({k: v for k, v in a.items() if k != "content_base64"})
    meta["prompt"] = GOLDEN_PROMPT
    (out / "response.json").write_text(json.dumps(meta, indent=2) + "\n", "utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
