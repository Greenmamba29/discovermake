"""Regenerate the golden worker outputs the web app's tests and evals replay.

    python -m cad_worker.golden            # from services/cad-worker (paths are repo-relative)

Writes:
  * ``tests/fixtures/cad/cad-worker-*.dxf``: one flat pattern per sheet family.
    ``tests/cad/cad-worker-quote*.test.ts`` feeds them through the R1 quote engine and
    requires a BINDING quote.
  * ``tests/fixtures/cad/acceptance/``: every artifact of the workflow 01 enclosure
    (``ACCEPTANCE_SPEC``) plus ``response.json`` (the worker response without the base64
    bodies). The acceptance test serves these when no CAD worker is running.
  * ``evals/cad/golden/<case>.json``: the worker response for each eval case's expected
    spec, with the DXF bodies inline (the eval quotes them) and the other artifacts as
    metadata only.

DXF, BOM, CSV, SVG and manifest bytes are deterministic; STEP and GLB come from
OpenCascade and may change between kernel versions (the tests never compare their bytes).
Regenerate whenever the DXF writer, a family or the eval cases change, and commit.
"""

from __future__ import annotations

import base64
import json
import os
import sys

from . import __version__
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
    "cad-worker-u-channel.dxf": {
        "family": "u_channel",
        "flange_a_mm": 30,
        "base_mm": 60,
        "flange_b_mm": 30,
        "length_mm": 120,
        "thickness_mm": 1.52,
        "inside_bend_radius_mm": 1.52,
        "holes": [
            {"flange": 1, "x_mm": 30, "y_mm": 30, "diameter_mm": 5},
            {"flange": 1, "x_mm": 90, "y_mm": 30, "diameter_mm": 5},
            {"flange": 0, "x_mm": 60, "y_mm": 10, "diameter_mm": 5},
        ],
    },
    "cad-worker-hat-bracket.dxf": {
        "family": "multi_bend_bracket",
        "flanges_mm": [20, 30, 40, 30, 20],
        "bend_angles_deg": [90, -90, -90, 90],
        "width_mm": 50,
        "thickness_mm": 1.52,
        "inside_bend_radius_mm": 1.52,
        "holes": [
            {"flange": 0, "x_mm": 25, "y_mm": 8, "diameter_mm": 4.5},
            {"flange": 4, "x_mm": 25, "y_mm": 12, "diameter_mm": 4.5},
            {"flange": 2, "x_mm": 25, "y_mm": 20, "diameter_mm": 5},
        ],
    },
    "cad-worker-z-bracket.dxf": {
        "family": "multi_bend_bracket",
        "flanges_mm": [25, 40, 25],
        "bend_angles_deg": [90, -90],
        "width_mm": 40,
        "thickness_mm": 1.52,
        "inside_bend_radius_mm": 1.52,
    },
    "cad-worker-slotted-plate.dxf": {
        "family": "slotted_plate",
        "width_mm": 160,
        "height_mm": 80,
        "thickness_mm": 3.04,
        "corner_radius_mm": 4,
        "holes": [{"x_mm": 20, "y_mm": 20, "diameter_mm": 6}, {"x_mm": 140, "y_mm": 20, "diameter_mm": 6}],
        "slots": [{"x_mm": 80, "y_mm": 55, "length_mm": 40, "width_mm": 8}, {"x_mm": 30, "y_mm": 55, "length_mm": 20, "width_mm": 6.5, "angle_deg": 90}],
        "countersinks": [{"x_mm": 60, "y_mm": 20, "through_diameter_mm": 3.4, "head_diameter_mm": 6.5}, {"x_mm": 100, "y_mm": 20, "through_diameter_mm": 3.4, "head_diameter_mm": 6.5}],
    },
}

#: Workflow 01 acceptance: "a weatherproof outdoor enclosure for a Raspberry Pi with a solar
#: battery", after the buyer answered the cavity size (180 x 120 x 70 mm) and the cable gland
#: (12.5 mm). Aluminium 5052, 0.063" (1.6 mm) with the catalog's 1.6 mm minimum bend radius.
ACCEPTANCE_SPEC = {
    "family": "sheet_enclosure",
    "inner_x_mm": 180,
    "inner_y_mm": 120,
    "inner_z_mm": 70,
    "thickness_mm": 1.6,
    "inside_bend_radius_mm": 1.6,
    "gland_diameter_mm": 12.5,
}


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _write(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def response_json(result, *, inline: set[str] | None = None, ref: str | None = None) -> dict:
    """The worker response; artifact bodies only for kinds in ``inline`` (None = all)."""
    body = result.to_json()
    body["ref"] = ref
    body["worker_version"] = __version__
    for a in body["artifacts"]:
        if inline is not None and a["kind"] not in inline:
            del a["content_base64"]
    return body


def write_flat_goldens(out_dir: str) -> None:
    for name, spec in GOLDEN.items():
        result = generate(GenerateRequest(spec=spec).spec, worker_version=__version__)
        dxf = next(a for a in result.artifacts if a.kind == "DXF")
        _write(os.path.join(out_dir, name), dxf.data)
        print(f"wrote {name} ({len(dxf.data)} bytes)")


def write_acceptance(out_dir: str) -> None:
    result = generate(GenerateRequest(spec=ACCEPTANCE_SPEC).spec, worker_version=__version__)
    for a in result.artifacts:
        _write(os.path.join(out_dir, a.filename), a.data)
    body = response_json(result, inline=set())
    _write(os.path.join(out_dir, "response.json"), (json.dumps(body, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    print(f"wrote acceptance fixture ({len(result.artifacts)} artifacts) to {out_dir}")


def write_eval_goldens(cases_path: str, out_dir: str) -> None:
    if not os.path.exists(cases_path):
        print(f"no eval cases at {cases_path}; skipped")
        return
    with open(cases_path, encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    os.makedirs(out_dir, exist_ok=True)
    for case in cases:
        spec = case.get("expected_spec")
        if not spec:
            continue
        result = generate(GenerateRequest(spec=spec).spec, worker_version=__version__)
        body = response_json(result, inline={"DXF"}, ref=f"eval:{case['id']}")
        path = os.path.join(out_dir, f"{case['id']}.json")
        _write(path, (json.dumps(body, indent=1, sort_keys=True) + "\n").encode("utf-8"))
        print(f"wrote {os.path.relpath(path, _repo_root())}")


def main(argv: list[str]) -> None:
    root = _repo_root()
    out = argv[1] if len(argv) > 1 else os.path.join(root, "tests", "fixtures", "cad")
    write_flat_goldens(out)
    write_acceptance(os.path.join(out, "acceptance"))
    write_eval_goldens(os.path.join(root, "evals", "cad", "cases.json"), os.path.join(root, "evals", "cad", "golden"))


if __name__ == "__main__":
    main(sys.argv)
