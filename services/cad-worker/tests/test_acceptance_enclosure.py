"""Workflow 01 acceptance (spec 7.10), the worker's share.

"Make me a weatherproof outdoor enclosure for a Raspberry Pi with a solar battery" must
persist eleven artifacts. The worker produces the geometry-side ones for the answered
spec (``ACCEPTANCE_SPEC``):

    5  initial CAD           STEP assembly, GLB preview, one DXF flat pattern per panel
    3  part decomposition    panels (+ quantities) in metrics, BOM and manifest
    6  preliminary BOM       bom.json + bom.csv (fabricated panels + purchased hardware)
    7  process recommendation  processes
       plus a dimensioned SVG drawing and a manifest with every sha256.

The other six (requirements, missing-info list, materials, Makeability, price range,
production time) and the persistent Build come from the web app; the end-to-end check of
all eleven is ``tests/cad/workflow-01-acceptance.test.ts``.
"""

import csv
import hashlib
import io
import json

import ezdxf
import pytest
from pydantic import ValidationError

from cad_worker.generate import generate
from cad_worker.golden import ACCEPTANCE_SPEC
from cad_worker.specs import GenerateRequest


@pytest.fixture(scope="module")
def result():
    return generate(GenerateRequest(spec=ACCEPTANCE_SPEC).spec, worker_version="test")


def by_name(result):
    return {a.filename: a for a in result.artifacts}


def test_initial_cad_step_glb_and_one_flat_pattern_per_panel(result):
    files = by_name(result)
    assert files["enclosure.step"].data.startswith(b"ISO-10303-21")
    assert files["enclosure.glb"].data[:4] == b"glTF"
    dxfs = [a for a in result.artifacts if a.kind == "DXF"]
    assert [a.filename for a in dxfs] == ["body_flat.dxf", "end_cap_flat.dxf", "end_cap_gland_flat.dxf", "lid_flat.dxf"]
    for a in dxfs:
        doc = ezdxf.read(io.StringIO(a.data.decode()))
        assert doc.header["$INSUNITS"] == 4
        layers = {e.dxf.layer for e in doc.modelspace()}
        assert layers == {"CUT", "BEND_90_UP"} or layers == {"CUT", "BEND_90_DOWN"}
        assert len([e for e in doc.modelspace() if "BEND" in e.dxf.layer]) == 2


def test_decomposition_and_cavity(result):
    m = result.metrics
    assert m["part_count"] == 4  # body, two end caps, lid
    assert [(p["name"], p["quantity"]) for p in m["panels"]] == [("body", 1), ("end_cap", 1), ("end_cap_gland", 1), ("lid", 1)]
    assert m["cavity_mm"] == [180, 120, 70]
    t = 1.6
    # x: lid over the walls (+ 0.5 mm clearance each side); y: body = cavity + both end caps; z: floor + cavity + lid gap + lid.
    assert m["bbox_mm"] == pytest.approx([120 + 4 * t + 1, 180 + 2 * t, 70 + 2 * t + 2.0], abs=0.01)


def test_preliminary_bom_lists_panels_and_hardware(result):
    files = by_name(result)
    bom = json.loads(files["bom.json"].data)
    fabricated = [i for i in bom["items"] if i["kind"] == "fabricated"]
    purchased = [i for i in bom["items"] if i["kind"] == "purchased"]
    assert [i["file"] for i in fabricated] == ["body_flat.dxf", "end_cap_flat.dxf", "end_cap_gland_flat.dxf", "lid_flat.dxf"]
    assert all(i["thickness_mm"] == 1.6 and i["bend_count"] == 2 for i in fabricated)
    names = " | ".join(i["name"] for i in purchased)
    assert "Blind rivet" in names and "M3" in names and "gasket" in names and "Cable gland" in names
    assert sum(i["quantity"] for i in purchased if "rivet" in i["name"].lower()) == 8
    rows = list(csv.DictReader(io.StringIO(files["bom.csv"].data.decode())))
    assert len(rows) == len(bom["items"])


def test_process_recommendation(result):
    assert result.processes == ["laser cutting", "press brake bending", "hardware insertion"]


def test_drawing_and_manifest(result):
    files = by_name(result)
    svg = files["drawing.svg"].data.decode()
    for label in ("Body (floor + side walls)", "End cap", "Lid with drip lips", "Purchased hardware"):
        assert label in svg
    assert svg.count('class="bend"') == 8  # two dashed bend lines per panel
    manifest = json.loads(files["manifest.json"].data)
    assert manifest["spec"]["inner_x_mm"] == 180
    for entry in manifest["artifacts"]:
        assert hashlib.sha256(files[entry["filename"]].data).hexdigest() == entry["sha256"]
    assert {e["filename"] for e in manifest["artifacts"]} == set(files) - {"manifest.json"}


@pytest.mark.parametrize(
    "bad",
    [
        {**ACCEPTANCE_SPEC, "inner_z_mm": 40},  # no room for the lid lip and end-cap rivets
        {**ACCEPTANCE_SPEC, "inner_x_mm": 60},  # lid screws would hit the end caps
        {**ACCEPTANCE_SPEC, "inner_y_mm": 50, "gland_diameter_mm": 40},  # gland does not fit the end cap
        {**ACCEPTANCE_SPEC, "lid_lip_mm": 8},  # no room for the lid screw
        {**ACCEPTANCE_SPEC, "floor_holes": [{"x_mm": 50, "y_mm": 2, "diameter_mm": 3}]},  # in the floor bend
        {**ACCEPTANCE_SPEC, "thickness_mm": 6},
    ],
)
def test_sheet_enclosure_bounds(bad):
    with pytest.raises(ValidationError):
        GenerateRequest(spec=bad)


def test_floor_holes_land_on_the_body_floor():
    spec = {**ACCEPTANCE_SPEC, "floor_holes": [{"x_mm": 40, "y_mm": 30, "diameter_mm": 2.7}, {"x_mm": 98, "y_mm": 79, "diameter_mm": 2.7}]}
    r = generate(GenerateRequest(spec=spec).spec)
    body = next(a for a in r.artifacts if a.filename == "body_flat.dxf")
    doc = ezdxf.read(io.StringIO(body.data.decode()))
    small = sorted((round(e.dxf.center.x, 3), round(e.dxf.center.y, 3)) for e in doc.modelspace() if e.dxftype() == "CIRCLE" and abs(e.dxf.radius - 1.35) < 1e-6)
    assert len(small) == 2
    # Floor-hole x maps to the body length (+ the end-cap plate); y onto the floor flat.
    assert small[0][0] == pytest.approx(40 + 1.6) and small[1][0] == pytest.approx(98 + 1.6)
    assert small[1][1] - small[0][1] == pytest.approx(79 - 30)
