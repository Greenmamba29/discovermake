"""Stage 1 families: U-channel, multi-bend bracket (Z / hat), slotted plate."""

import csv
import io
import json
import math

import ezdxf
import pytest
from pydantic import ValidationError

from cad_worker.generate import generate
from cad_worker.golden import GOLDEN
from cad_worker.specs import MIN_FLANGE_RATIO, GenerateRequest, bend_allowance

U_CHANNEL = GOLDEN["cad-worker-u-channel.dxf"]
HAT = GOLDEN["cad-worker-hat-bracket.dxf"]
Z = GOLDEN["cad-worker-z-bracket.dxf"]
PLATE = GOLDEN["cad-worker-slotted-plate.dxf"]


def spec(d):
    return GenerateRequest(spec=d).spec


def artifact(result, kind):
    return next(a for a in result.artifacts if a.kind == kind)


def read_dxf(a):
    return ezdxf.read(io.StringIO(a.data.decode("utf-8")))


def bend_lines(doc):
    return sorted((e for e in doc.modelspace() if "BEND" in e.dxf.layer), key=lambda e: e.dxf.start.y)


# ---------------------------------------------------------------------------
# U-channel
# ---------------------------------------------------------------------------


def test_u_channel_folded_size_and_flat_pattern():
    s = spec(U_CHANNEL)
    r = generate(s)
    t, rad = 1.52, 1.52
    ba = bend_allowance(rad, t, 0.44)
    flats = [30 - (rad + t), 60 - 2 * (rad + t), 30 - (rad + t)]
    total = sum(flats) + 2 * ba
    assert r.metrics["bbox_mm"] == pytest.approx([60, 120, 30], abs=0.01)  # outside dimensions
    assert r.metrics["flat_size_mm"] == pytest.approx([120, total], abs=1e-3)
    assert r.metrics["bend_count"] == 2
    # Folded volume ~= flat volume minus holes (exact only at K = 0.5).
    flat_volume = 120 * total * t - 3 * math.pi * 2.5**2 * t
    assert r.metrics["volume_mm3"] == pytest.approx(flat_volume, rel=0.01)

    doc = read_dxf(artifact(r, "DXF"))
    assert doc.header["$INSUNITS"] == 4
    assert {e.dxf.layer for e in doc.modelspace()} == {"CUT", "BEND_90_UP"}
    bends = bend_lines(doc)
    assert [b.dxf.start.y for b in bends] == pytest.approx([flats[0] + ba / 2, flats[0] + ba + flats[1] + ba / 2])
    assert all(b.dxf.start.x == 0 and b.dxf.end.x == 120 for b in bends)
    holes = sorted((e.dxf.center.x, round(e.dxf.center.y, 3)) for e in doc.modelspace() if e.dxftype() == "CIRCLE")
    base_y = flats[0] + ba + (30 - (rad + t))
    assert holes == [(30, pytest.approx(base_y, abs=1e-3)), (60, pytest.approx(10)), (90, pytest.approx(base_y, abs=1e-3))]


@pytest.mark.parametrize(
    "bad",
    [
        {**U_CHANNEL, "flange_a_mm": 7},  # flat flange below 4 x thickness
        {**U_CHANNEL, "base_mm": 5, "flange_a_mm": 30},  # base shorter than its two setbacks
        {**U_CHANNEL, "holes": [{"flange": 1, "x_mm": 30, "y_mm": 4, "diameter_mm": 5}]},  # hole in the bend zone
        {**U_CHANNEL, "holes": [{"flange": 0, "x_mm": 1, "y_mm": 10, "diameter_mm": 5}]},  # hole closer than t to the side edge
        {**U_CHANNEL, "holes": [{"flange": 3, "x_mm": 30, "y_mm": 10, "diameter_mm": 5}]},  # no such flange
        {**U_CHANNEL, "thickness_mm": 13},
        {**U_CHANNEL, "code": "import os"},
    ],
)
def test_u_channel_bounds(bad):
    with pytest.raises(ValidationError):
        spec(bad)


def test_min_flange_rule_matches_the_quote_engine():
    # Exactly at the limit is accepted, a hair below is not.
    t, rad, k = 2.0, 2.0, 0.44
    ba = bend_allowance(rad, t, k)
    limit = MIN_FLANGE_RATIO * t - ba / 2 + rad + t
    ok = {**U_CHANNEL, "thickness_mm": t, "inside_bend_radius_mm": rad, "holes": [], "flange_a_mm": round(limit + 0.001, 3)}
    spec(ok)
    with pytest.raises(ValidationError, match="press brake"):
        spec({**ok, "flange_a_mm": round(limit - 0.01, 3)})


# ---------------------------------------------------------------------------
# Multi-bend bracket
# ---------------------------------------------------------------------------


def test_hat_profile_bends_alternate_direction():
    r = generate(spec(HAT))
    assert r.metrics["profile"] == "hat-profile"
    assert r.metrics["bend_count"] == 4
    doc = read_dxf(artifact(r, "DXF"))
    assert [b.dxf.layer for b in bend_lines(doc)] == ["BEND_90_UP", "BEND_90_DOWN", "BEND_90_DOWN", "BEND_90_UP"]
    # Height = wall outside length; width spans brim + top + brim (outside per bend).
    assert r.metrics["bbox_mm"][2] == pytest.approx(30, abs=0.01)
    assert r.metrics["bbox_mm"][1] == pytest.approx(50, abs=0.01)
    assert len([e for e in doc.modelspace() if e.dxftype() == "CIRCLE"]) == 3


def test_z_profile_overall_height():
    r = generate(spec(Z))
    assert r.metrics["profile"] == "z-profile"
    assert r.metrics["bbox_mm"] == pytest.approx([25 + 25 - 1.52, 40, 40], abs=0.01)
    doc = read_dxf(artifact(r, "DXF"))
    assert [b.dxf.layer for b in bend_lines(doc)] == ["BEND_90_UP", "BEND_90_DOWN"]


@pytest.mark.parametrize(
    "bad",
    [
        {**Z, "bend_angles_deg": [90]},  # flanges != bends + 1
        {**Z, "bend_angles_deg": [90, 45]},  # only +/-90
        {**Z, "flanges_mm": [25, 40, 25, 40, 25, 40], "bend_angles_deg": [90, -90, 90, -90, 90]},  # > 4 bends
        {**Z, "flanges_mm": [25, 6, 25]},  # middle flange shorter than its setbacks
        {**HAT, "holes": [{"flange": 4, "x_mm": 25, "y_mm": 3, "diameter_mm": 4.5}]},  # last flange measured from its start face
    ],
)
def test_multi_bend_bounds(bad):
    with pytest.raises(ValidationError):
        spec(bad)


# ---------------------------------------------------------------------------
# Slotted plate
# ---------------------------------------------------------------------------


def test_slotted_plate_dxf_cuts_through_diameter_and_obround_slots():
    r = generate(spec(PLATE))
    doc = read_dxf(artifact(r, "DXF"))
    assert {e.dxf.layer for e in doc.modelspace()} == {"CUT"}  # no COUNTERSINK layer: R1 would cut it
    circles = sorted(round(e.dxf.radius * 2, 3) for e in doc.modelspace() if e.dxftype() == "CIRCLE")
    assert circles == [3.4, 3.4, 6, 6]  # countersinks cut at their through-diameter
    polylines = [e for e in doc.modelspace() if e.dxftype() == "LWPOLYLINE"]
    assert len(polylines) == 3  # outline + two slots
    slot = next(p for p in polylines if len(p) == 4 and all(abs(b) in (0, 1) for *_, b in p.get_points("xyb")))
    assert [abs(b) for *_, b in slot.get_points("xyb")] == [0, 1, 0, 1]
    assert r.metrics["countersink_count"] == 2
    assert r.metrics["countersinks"][0]["depth_mm"] == pytest.approx((6.5 - 3.4) / 2, abs=1e-3)  # 90 degree cone
    # The cone is in the solid: volume below a plain through-hole plate.
    t = 3.04
    plain = 160 * 80 * t - 4 * (16 - math.pi * 16 / 4) * t - 2 * math.pi * 9 * t - 2 * math.pi * 1.7**2 * t
    slots = (32 * 8 + math.pi * 16) * t + (13.5 * 6.5 + math.pi * 3.25**2) * t
    assert r.metrics["volume_mm3"] < plain - slots
    assert r.processes == ["laser cutting", "countersinking"]
    bom = json.loads(artifact(r, "BOM").data)
    assert "Countersink 2x d3.4 to d6.5 x 90deg" in bom["items"][0]["notes"]


@pytest.mark.parametrize(
    "bad",
    [
        {**PLATE, "slots": [{"x_mm": 80, "y_mm": 76, "length_mm": 40, "width_mm": 8}]},  # crosses the top edge
        {**PLATE, "slots": [{"x_mm": 80, "y_mm": 55, "length_mm": 8, "width_mm": 8}]},  # not longer than wide
        {**PLATE, "slots": [{"x_mm": 80, "y_mm": 55, "length_mm": 40, "width_mm": 2}]},  # narrower than the sheet
        {**PLATE, "holes": [{"x_mm": 2.5, "y_mm": 40, "diameter_mm": 3}]},  # hole edge closer than t to the edge
        {**PLATE, "holes": [{"x_mm": 60, "y_mm": 27, "diameter_mm": 4}]},  # web to a countersink below t
        {**PLATE, "countersinks": [{"x_mm": 60, "y_mm": 20, "through_diameter_mm": 3.4, "head_diameter_mm": 9}]},  # cone too deep
        {**PLATE, "countersinks": [{"x_mm": 60, "y_mm": 20, "through_diameter_mm": 6, "head_diameter_mm": 5}]},  # head smaller than bore
        {**PLATE, "holes": [], "slots": [], "countersinks": []},  # that is a sheet_panel
        {**PLATE, "corner_radius_mm": 25, "holes": [{"x_mm": 6, "y_mm": 6, "diameter_mm": 3}]},  # inside the corner radius
    ],
)
def test_slotted_plate_bounds(bad):
    with pytest.raises(ValidationError):
        spec(bad)


# ---------------------------------------------------------------------------
# Documents on every family
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_every_family_ships_bom_drawing_and_manifest(name):
    s = spec(GOLDEN[name])
    r = generate(s, worker_version="test")
    by_name = {a.filename: a for a in r.artifacts}
    bom = json.loads(by_name["bom.json"].data)
    assert bom["version"] == "dm-bom/1" and bom["units"] == "mm"
    assert bom["items"][0]["file"] == artifact(r, "DXF").filename
    rows = list(csv.DictReader(io.StringIO(by_name["bom.csv"].data.decode())))
    assert [int(row["item"]) for row in rows] == [it["item"] for it in bom["items"]]
    svg = by_name["drawing.svg"].data.decode()
    assert svg.startswith("<svg") and "all dimensions in mm" in svg
    manifest = json.loads(by_name["manifest.json"].data)
    assert r.artifacts[-1].filename == "manifest.json"
    listed = {m["filename"]: m["sha256"] for m in manifest["artifacts"]}
    assert listed == {a.filename: a.sha256 for a in r.artifacts[:-1]}
    assert manifest["spec"]["family"] == s.family and manifest["worker_version"] == "test"


def test_documents_are_deterministic():
    a = generate(spec(HAT), worker_version="x")
    b = generate(spec(HAT), worker_version="x")
    for kind in ("DXF", "BOM", "CSV", "SVG"):
        assert artifact(a, kind).data == artifact(b, kind).data
