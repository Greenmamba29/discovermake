"""R6 Reconstruct printed families: round knob and spacer / bushing.

Bounds (strict, bounded specs), geometry (volume and area against closed forms), the STL
(binary, millimetres, watertight-sized), determinism of every artifact, the manifest metrics
the print quote engine prices from, and the committed golden fixtures.
"""

import json
import math
import os
import struct

import pytest
from pydantic import ValidationError

from cad_worker import __version__
from cad_worker.generate import generate
from cad_worker.golden import RECONSTRUCT_GOLDEN, _repo_root
from cad_worker.specs import POINTER_NOTCH_DEPTH_MM, PRINT_WALL_FLOOR_MM, PRINTED_FAMILIES, GenerateRequest

KNOB = RECONSTRUCT_GOLDEN["reconstruct-knob"]
SPACER = RECONSTRUCT_GOLDEN["reconstruct-spacer"]
PLAIN_KNOB = {"family": "round_knob", "diameter_mm": 30, "height_mm": 15, "bore_type": "round", "shaft_diameter_mm": 6, "bore_depth_mm": 12, "chamfer_mm": 0}
PLAIN_SPACER = {"family": "spacer_bushing", "outer_diameter_mm": 10, "inner_diameter_mm": 5, "length_mm": 20}


def spec(d):
    return GenerateRequest(spec=d).spec


def artifact(result, kind):
    return next(a for a in result.artifacts if a.kind == kind)


def stl_triangles(data: bytes) -> list[tuple[float, ...]]:
    (n,) = struct.unpack_from("<I", data, 80)
    assert len(data) == 84 + 50 * n, "binary STL length matches its triangle count"
    return [struct.unpack_from("<12f", data, 84 + 50 * i) for i in range(n)]


@pytest.fixture(scope="module")
def knob():
    return generate(spec(KNOB), worker_version=__version__)


@pytest.fixture(scope="module")
def spacer():
    return generate(spec(SPACER), worker_version=__version__)


def test_printed_families_are_registered():
    assert PRINTED_FAMILIES == ("round_knob", "spacer_bushing")


def test_knob_artifacts_and_metrics(knob):
    assert [a.kind for a in knob.artifacts] == ["STEP", "STL", "GLB", "BOM", "CSV", "SVG", "MANIFEST"]
    assert knob.processes == ["3D printing"]
    m = knob.metrics
    assert m["bbox_mm"] == [38.1, 38.1, 22]
    # Wall: (38.1 - (6 + 0.15)) / 2 - 0.8 rib = 15.175; cap: 22 - 20 - 0.6 notch = 1.4.
    assert m["min_wall_mm"] == pytest.approx(22 - 20 - POINTER_NOTCH_DEPTH_MM)
    assert m["bridge_span_mm"] == pytest.approx(6.15)
    cylinder = math.pi * 19.05**2 * 22
    assert 0.9 * cylinder < m["volume_mm3"] < cylinder
    assert m["surface_area_mm2"] > 2 * math.pi * 19.05 * 22


def test_plain_knob_volume_and_area_match_closed_forms():
    r = generate(spec(PLAIN_KNOB))
    R, b, h, d = 15, (6 + 0.15) / 2, 15, 12
    assert r.metrics["volume_mm3"] == pytest.approx(math.pi * R**2 * h - math.pi * b**2 * d, rel=1e-4)
    area = 2 * math.pi * R * h + 2 * math.pi * R**2 + 2 * math.pi * b * d  # outside + both faces + bore wall (bore mouth replaces bottom area, ceiling adds it back)
    assert r.metrics["surface_area_mm2"] == pytest.approx(area, rel=1e-3)
    assert r.metrics["min_wall_mm"] == pytest.approx(3.0)


def test_spacer_volume_area_and_flange(spacer):
    m = spacer.metrics
    assert m["bbox_mm"] == [18, 18, 10]
    tube = math.pi * (6**2 - 3.25**2) * 10
    flange = math.pi * (9**2 - 6**2) * 2
    assert m["volume_mm3"] == pytest.approx(tube + flange, rel=1e-4)
    assert m["min_wall_mm"] == pytest.approx(2.0)  # flange thickness < tube wall 2.75
    plain = generate(spec(PLAIN_SPACER)).metrics
    assert plain["volume_mm3"] == pytest.approx(math.pi * (25 - 6.25) * 20, rel=1e-4)
    assert plain["surface_area_mm2"] == pytest.approx(2 * math.pi * 5 * 20 + 2 * math.pi * 2.5 * 20 + 2 * math.pi * (25 - 6.25), rel=1e-3)


def test_stl_is_binary_millimetres_and_closed(knob):
    data = artifact(knob, "STL").data
    assert data[:80].startswith(b"DiscoverMake CAD worker binary STL, units mm")
    tris = stl_triangles(data)
    xs = [v for t in tris for v in (t[3], t[6], t[9])]
    zs = [v for t in tris for v in (t[5], t[8], t[11])]
    assert max(xs) - min(xs) == pytest.approx(38.1, abs=0.05)
    assert min(zs) == pytest.approx(0, abs=1e-3) and max(zs) == pytest.approx(22, abs=1e-3)
    # Signed volume of the closed mesh (divergence theorem) matches the B-rep volume.
    vol = 0.0
    for t in tris:
        a, b, c = t[3:6], t[6:9], t[9:12]
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    assert abs(vol) == pytest.approx(knob.metrics["volume_mm3"], rel=0.01)


def test_manifest_carries_print_metrics_and_hashes(knob):
    manifest = json.loads(artifact(knob, "MANIFEST").data)
    assert manifest["family"] == "round_knob"
    assert manifest["metrics"] == {k: knob.metrics[k] for k in ("bbox_mm", "volume_mm3", "surface_area_mm2", "min_wall_mm", "bridge_span_mm")}
    listed = {a["filename"]: a["sha256"] for a in manifest["artifacts"]}
    for a in knob.artifacts[:-1]:
        assert listed[a.filename] == a.sha256
    bom = json.loads(artifact(knob, "BOM").data)
    assert bom["items"][0]["file"] == "knob.stl"
    assert bom["items"][0]["process"].startswith("3D printing")
    assert "<circle" in artifact(knob, "SVG").data.decode()


def test_every_artifact_is_deterministic(knob):
    again = generate(spec(KNOB), worker_version=__version__)
    assert [a.sha256 for a in again.artifacts] == [a.sha256 for a in knob.artifacts]


def test_committed_goldens_match_the_worker(knob, spacer):
    root = os.path.join(_repo_root(), "tests", "fixtures", "cad")
    for name, result in (("reconstruct-knob", knob), ("reconstruct-spacer", spacer)):
        recorded = json.load(open(os.path.join(root, name, "response.json")))
        assert recorded["family"] == result.family
        assert recorded["metrics"] == json.loads(json.dumps(result.metrics))
        for a in result.artifacts:
            with open(os.path.join(root, name, a.filename), "rb") as f:
                on_disk = f.read()
            if a.kind in ("STEP", "GLB"):
                continue  # OpenCascade output may differ between kernel versions; never compared
            assert on_disk == a.data, f"{name}/{a.filename} is stale: run python -m cad_worker.golden"


@pytest.mark.parametrize(
    "bad",
    [
        {**KNOB, "diameter_mm": 7},  # below the bound
        {**KNOB, "shaft_flat_depth_mm": None},  # D-shaft without its flat
        {**PLAIN_KNOB, "shaft_flat_depth_mm": 1.5},  # flat on a round bore
        {**KNOB, "shaft_flat_depth_mm": 3},  # flat as deep as the radius
        {**KNOB, "bore_depth_mm": 21.5},  # no cap above the bore
        {**KNOB, "diameter_mm": 8.5, "grip_ribs": 8},  # radial wall 1.175 - 0.8 rib < 0.8 mm floor
        {**KNOB, "grip_ribs": 60},  # flutes merge
        {**KNOB, "chamfer_mm": 6.5},  # chamfer over a sixth of the diameter
        {**KNOB, "script": "import os"},  # extra fields are rejected: no code paths
        {**SPACER, "inner_diameter_mm": 11},  # 0.5 mm wall
        {**SPACER, "flange_thickness_mm": None},  # half a flange
        {**SPACER, "flange_diameter_mm": 11},  # flange smaller than the tube
        {**SPACER, "flange_thickness_mm": 10},  # flange as long as the part
        {**PLAIN_SPACER, "chamfer_mm": 2},  # chamfer eats the wall
    ],
)
def test_bounds(bad):
    with pytest.raises(ValidationError):
        spec(bad)


def test_wall_floor_is_below_the_print_dfm_minimum():
    # The worker only refuses unbuildable walls; the 1.2 mm print DFM is the quote engine's call.
    assert PRINT_WALL_FLOOR_MM < 1.2
    thin = spec({**PLAIN_KNOB, "diameter_mm": 8, "bore_depth_mm": 12})
    assert thin.min_wall_mm() == pytest.approx(0.925)
