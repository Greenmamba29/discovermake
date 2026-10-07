import io
import math

import ezdxf
import pytest
from pydantic import ValidationError

from cad_worker.generate import bracket_flat_length, generate
from cad_worker.specs import GenerateRequest

PANEL = {
    "family": "sheet_panel",
    "width_mm": 200,
    "height_mm": 100,
    "thickness_mm": 3,
    "corner_radius_mm": 5,
    "holes": [{"x_mm": 20, "y_mm": 20, "diameter_mm": 6}],
}
BRACKET = {
    "family": "l_bracket",
    "leg_a_mm": 50,
    "leg_b_mm": 80,
    "width_mm": 40,
    "thickness_mm": 2,
    "inside_bend_radius_mm": 2,
    "holes_a": [{"x_mm": 20, "y_mm": 15, "diameter_mm": 5}],
    "holes_b": [{"x_mm": 20, "y_mm": 20, "diameter_mm": 5}],
}
ENCLOSURE = {
    "family": "enclosure",
    "inner_x_mm": 90,
    "inner_y_mm": 65,
    "inner_z_mm": 40,
    "wall_mm": 2.5,
    "corner_radius_mm": 4,
    "lid": True,
    "vent_slots": 6,
    "standoffs": [{"x_mm": 29, "y_mm": 24.5, "height_mm": 5, "outer_diameter_mm": 6, "hole_diameter_mm": 2.5}],
}


def spec(d):
    return GenerateRequest(spec=d).spec


def artifact(result, kind):
    return next(a for a in result.artifacts if a.kind == kind)


def read_dxf(a):
    return ezdxf.read(io.StringIO(a.data.decode("utf-8")))


def test_sheet_panel_volume_and_dxf_layers():
    r = generate(spec(PANEL))
    expected = 200 * 100 * 3 - 4 * (25 - math.pi * 25 / 4) * 3 - math.pi * 9 * 3
    assert r.metrics["volume_mm3"] == pytest.approx(expected, rel=1e-4)
    assert r.metrics["bbox_mm"] == pytest.approx([200, 100, 3], abs=0.01)
    doc = read_dxf(artifact(r, "DXF"))
    assert doc.header["$INSUNITS"] == 4
    layers = {e.dxf.layer for e in doc.modelspace()}
    assert layers == {"CUT"}
    assert artifact(r, "STEP").data.startswith(b"ISO-10303-21")
    assert artifact(r, "GLB").data[:4] == b"glTF"


def test_l_bracket_flat_pattern_math_and_bend_layer():
    s = spec(BRACKET)
    flat_a, ba, flat_b, total = bracket_flat_length(s)
    assert flat_a == pytest.approx(46)  # 50 - (r + t)
    assert flat_b == pytest.approx(76)
    assert ba == pytest.approx(math.pi / 2 * (2 + 0.44 * 2))
    r = generate(s)
    assert r.metrics["flat_size_mm"] == pytest.approx([40, total], abs=1e-3)
    assert r.metrics["bbox_mm"] == pytest.approx([80, 40, 50], abs=0.01)
    # Folded volume ~= flat volume (exact only at K = 0.5).
    flat_volume = 40 * total * 2 - 2 * math.pi * 2.5**2 * 2
    assert r.metrics["volume_mm3"] == pytest.approx(flat_volume, rel=0.01)
    doc = read_dxf(artifact(r, "DXF"))
    bends = [e for e in doc.modelspace() if e.dxf.layer == "BEND_90"]
    assert len(bends) == 1 and bends[0].dxftype() == "LINE"
    assert bends[0].dxf.start.y == pytest.approx(flat_a + ba / 2)
    holes = sorted(e.dxf.center.y for e in doc.modelspace() if e.dxftype() == "CIRCLE")
    assert holes == pytest.approx([15, total - 20])


def test_enclosure_has_base_and_lid():
    r = generate(spec(ENCLOSURE))
    assert r.metrics["part_count"] == 2
    assert r.metrics["bbox_mm"] == pytest.approx([95, 70, 45], abs=0.01)
    assert {a.kind for a in r.artifacts} == {"STEP", "GLB"}
    assert r.processes == ["3D printing", "CNC milling"]


@pytest.mark.parametrize(
    "bad",
    [
        {**PANEL, "holes": [{"x_mm": 1, "y_mm": 20, "diameter_mm": 6}]},  # hole crosses the edge
        {**PANEL, "corner_radius_mm": 60},
        {**PANEL, "width_mm": 5000},
        {**PANEL, "script": "import os"},  # extra fields are rejected: no code paths
        {**BRACKET, "leg_a_mm": 10, "thickness_mm": 5, "inside_bend_radius_mm": 5},
        {**ENCLOSURE, "standoffs": [{"x_mm": 60, "y_mm": 0, "height_mm": 5, "outer_diameter_mm": 6, "hole_diameter_mm": 2.5}]},
        {**ENCLOSURE, "vent_slots": 20},
        {"family": "turbine_blade"},
    ],
)
def test_invalid_specs_are_rejected(bad):
    with pytest.raises(ValidationError):
        spec(bad)


def test_dxf_output_is_deterministic():
    a = artifact(generate(spec(BRACKET)), "DXF").data
    b = artifact(generate(spec(BRACKET)), "DXF").data
    assert a == b
