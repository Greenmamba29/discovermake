"""Write the SolidCraft goldens the web app's tests replay (tests/fixtures/text-to-cad/solidcraft/).

    SOLIDCRAFT_CLI=/opt/solidcraft/bin/solidcraft-cli python -m cad_worker.solidcraft.golden

One real build of the cable-holder script through the gate and sandbox, then one real rebuild of its
saved design with L = 80 mm. Each folder holds the files and `response.json` (the worker's answer
with the file contents left out). The app's tests serve them from a fake worker, so they need no
engine; the e2e seam plants them the same way.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from .runner import build_commands, rebuild_design

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "tests" / "fixtures" / "text-to-cad" / "solidcraft"
SCRIPT = OUT / "model.solidcraft.json"
REBUILD = {"L": "80 mm"}


def _write(folder: Path, result: dict) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    meta = {k: v for k, v in result.items() if k not in ("artifacts", "design", "build_ms")}
    meta["artifacts"] = []
    for a in result["artifacts"]:
        (folder / a["filename"]).write_bytes(base64.b64decode(a["content_base64"]))
        meta["artifacts"].append({k: a[k] for k in ("kind", "filename", "sha256", "bytes")})
    d = result["design"]
    (folder / d["filename"]).write_bytes(base64.b64decode(d["content_base64"]))
    meta["design"] = {k: d[k] for k in ("filename", "sha256", "bytes")}
    meta["build_ms"] = 1200
    (folder / "response.json").write_text(json.dumps(meta, indent=1, sort_keys=True) + "\n", "utf-8")


def main() -> int:
    script = json.loads(SCRIPT.read_text("utf-8"))
    base = build_commands(script, ["step", "glb", "stl"])
    if not base.get("ok"):
        print("build failed:", base, file=sys.stderr)
        return 1
    _write(OUT / "build", base)
    design = base64.b64decode(base["design"]["content_base64"])
    wide = rebuild_design(design, base["design"]["sha256"], REBUILD, ["step", "glb", "stl"])
    if not wide.get("ok"):
        print("rebuild failed:", wide, file=sys.stderr)
        return 1
    _write(OUT / "rebuild-L80", wide)
    print(f"wrote {OUT.relative_to(ROOT)}: build {base['geometry']}, L=80 {wide['geometry']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
