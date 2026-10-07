"""CadSpec -> artifacts (STEP, DXF flat pattern, GLB) with CadQuery.

Sheet-metal DXFs follow the DiscoverMake quote-engine conventions
(``src/server/quote/dxf/parse.ts``): millimetres ($INSUNITS = 4), cut geometry
on layer ``CUT``, bend lines on a layer containing ``BEND`` with the angle in its
name (``BEND_90``). That lets a generated flat pattern go straight into the R1
instant quote engine.
"""

from __future__ import annotations

import base64
import hashlib
import io
import math
import os
import tempfile
from dataclasses import dataclass, field

import cadquery as cq
import ezdxf

from .specs import FAMILY_PROCESS, Enclosure, LBracket, SheetPanel

INSUNITS_MM = 4

# Deterministic DXF output: fixed creation/update timestamps and GUIDs, so the same
# spec always yields the same bytes (and sha256). Golden files and caching rely on it.
ezdxf.options.write_fixed_meta_data_for_testing = True


@dataclass
class Artifact:
    kind: str  # STEP | DXF | GLB
    filename: str
    content_type: str
    data: bytes

    def to_json(self) -> dict:
        return {
            "kind": self.kind,
            "filename": self.filename,
            "content_type": self.content_type,
            "bytes": len(self.data),
            "sha256": hashlib.sha256(self.data).hexdigest(),
            "content_base64": base64.b64encode(self.data).decode("ascii"),
        }


@dataclass
class Result:
    family: str
    artifacts: list[Artifact]
    metrics: dict
    processes: list[str]
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "family": self.family,
            "artifacts": [a.to_json() for a in self.artifacts],
            "metrics": self.metrics,
            "processes": self.processes,
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Exporters
# ---------------------------------------------------------------------------


def _step(shape: cq.Workplane | cq.Assembly, name: str) -> Artifact:
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, f"{name}.step")
        if isinstance(shape, cq.Assembly):
            shape.export(path, "STEP")
        else:
            cq.exporters.export(shape, path, cq.exporters.ExportTypes.STEP)
        with open(path, "rb") as f:
            return Artifact("STEP", f"{name}.step", "model/step", f.read())


def _glb(parts: list[tuple[str, cq.Workplane, tuple[float, float, float]]], name: str) -> Artifact:
    assy = cq.Assembly(name=f"{name}_model")
    for label, wp, color in parts:
        assy.add(wp, name=label, color=cq.Color(*color))
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, f"{name}.glb")
        assy.export(path, "GLTF", binary=True)
        with open(path, "rb") as f:
            return Artifact("GLB", f"{name}.glb", "model/gltf-binary", f.read())


def _dxf_doc() -> ezdxf.document.Drawing:
    doc = ezdxf.new("R2010", setup=False)
    doc.header["$INSUNITS"] = INSUNITS_MM
    doc.header["$MEASUREMENT"] = 1
    doc.layers.add("CUT", color=7)
    return doc


def _dxf_bytes(doc: ezdxf.document.Drawing, name: str) -> Artifact:
    buf = io.StringIO()
    doc.write(buf)
    return Artifact("DXF", f"{name}.dxf", "application/dxf", buf.getvalue().encode("utf-8"))


def _rounded_rect(msp, w: float, h: float, r: float) -> None:
    """Closed outline as one LWPOLYLINE (bulges for the rounded corners)."""
    if r <= 0:
        msp.add_lwpolyline([(0, 0), (w, 0), (w, h), (0, h)], close=True, dxfattribs={"layer": "CUT"})
        return
    b = math.tan(math.pi / 8)  # 90-degree arc
    pts = [
        (r, 0, 0),
        (w - r, 0, b),
        (w, r, 0),
        (w, h - r, b),
        (w - r, h, 0),
        (r, h, b),
        (0, h - r, 0),
        (0, r, b),
    ]
    msp.add_lwpolyline(pts, format="xyb", close=True, dxfattribs={"layer": "CUT"})


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------


def sheet_panel(spec: SheetPanel) -> Result:
    w, h, t = spec.width_mm, spec.height_mm, spec.thickness_mm
    solid = cq.Workplane("XY").rect(w, h, centered=False).extrude(t)
    if spec.corner_radius_mm > 0:
        solid = solid.edges("|Z").fillet(spec.corner_radius_mm)
    for hole in spec.holes:
        solid = solid.cut(cq.Workplane("XY").center(hole.x_mm, hole.y_mm).circle(hole.diameter_mm / 2).extrude(t))

    doc = _dxf_doc()
    msp = doc.modelspace()
    _rounded_rect(msp, w, h, spec.corner_radius_mm)
    for hole in spec.holes:
        msp.add_circle((hole.x_mm, hole.y_mm), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})

    return Result(
        family=spec.family,
        artifacts=[_dxf_bytes(doc, "panel_flat"), _step(solid, "panel"), _glb([("panel", solid, (0.72, 0.74, 0.78))], "panel")],
        metrics=_metrics(solid, flat=(w, h), thickness=t, bends=0),
        processes=FAMILY_PROCESS[spec.family],
    )


def bracket_flat_length(spec: LBracket) -> tuple[float, float, float, float]:
    """(flat_a, bend_allowance, flat_b, total) for a 90-degree bend, K-factor method."""
    t, r = spec.thickness_mm, spec.inside_bend_radius_mm
    setback = r + t
    flat_a = spec.leg_a_mm - setback
    flat_b = spec.leg_b_mm - setback
    ba = (math.pi / 2) * (r + spec.k_factor * t)
    return flat_a, ba, flat_b, flat_a + ba + flat_b


def l_bracket(spec: LBracket) -> Result:
    t, r, w = spec.thickness_mm, spec.inside_bend_radius_mm, spec.width_mm
    a, b = spec.leg_a_mm, spec.leg_b_mm
    ro = r + t
    c45 = math.cos(math.pi / 4)

    # Section in the XZ plane: leg A rises along +Z at x in [0, t]; leg B runs along +X at z in [0, t].
    section = (
        cq.Workplane("XZ")
        .moveTo(0, a)
        .lineTo(0, ro)
        .threePointArc((ro - ro * c45, ro - ro * c45), (ro, 0))
        .lineTo(b, 0)
        .lineTo(b, t)
        .lineTo(ro, t)
        .threePointArc((ro - r * c45, ro - r * c45), (t, ro))
        .lineTo(t, a)
        .close()
    )
    # XZ normal is -Y, so extrude(-w) goes towards +Y: the part spans y in [0, w].
    solid = section.extrude(-w)
    for hole in spec.holes_a:  # leg A: across width = y, from its free edge = down from z = a
        cyl = cq.Workplane("YZ").center(hole.x_mm, a - hole.y_mm).circle(hole.diameter_mm / 2).extrude(t * 3, both=True)
        solid = solid.cut(cyl)
    for hole in spec.holes_b:  # leg B: across width = y, from its free edge = back from x = b
        cyl = cq.Workplane("XY").center(b - hole.y_mm, hole.x_mm).circle(hole.diameter_mm / 2).extrude(t * 3, both=True)
        solid = solid.cut(cyl)

    flat_a, ba, flat_b, total = bracket_flat_length(spec)
    doc = _dxf_doc()
    doc.layers.add("BEND_90", color=1)
    msp = doc.modelspace()
    _rounded_rect(msp, w, total, 0)
    bend_y = flat_a + ba / 2
    msp.add_line((0, bend_y), (w, bend_y), dxfattribs={"layer": "BEND_90"})
    for hole in spec.holes_a:
        msp.add_circle((hole.x_mm, hole.y_mm), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})
    for hole in spec.holes_b:
        msp.add_circle((hole.x_mm, total - hole.y_mm), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})

    warnings = []
    if r < t:
        warnings.append("Inside bend radius is below the material thickness; many shops need r >= t.")
    return Result(
        family=spec.family,
        artifacts=[_dxf_bytes(doc, "bracket_flat"), _step(solid, "bracket"), _glb([("bracket", solid, (0.72, 0.74, 0.78))], "bracket")],
        metrics={
            **_metrics(solid, flat=(w, total), thickness=t, bends=1),
            "flat_pattern": {"flange_a_mm": round(flat_a, 3), "bend_allowance_mm": round(ba, 3), "flange_b_mm": round(flat_b, 3), "bend_line_y_mm": round(bend_y, 3)},
        },
        processes=FAMILY_PROCESS[spec.family],
        warnings=warnings,
    )


def enclosure(spec: Enclosure) -> Result:
    wall = spec.wall_mm
    ox, oy = spec.inner_x_mm + 2 * wall, spec.inner_y_mm + 2 * wall
    oz = spec.inner_z_mm + wall  # open top; floor = wall
    base = cq.Workplane("XY").box(ox, oy, oz, centered=(True, True, False))
    if spec.corner_radius_mm > 0:
        base = base.edges("|Z").fillet(spec.corner_radius_mm)
    cavity = cq.Workplane("XY").workplane(offset=wall).box(spec.inner_x_mm, spec.inner_y_mm, spec.inner_z_mm + 1, centered=(True, True, False))
    inner_r = max(spec.corner_radius_mm - wall, 0)
    if inner_r > 0.2:
        cavity = cavity.edges("|Z").fillet(inner_r)
    base = base.cut(cavity)

    for s in spec.standoffs:
        boss = cq.Workplane("XY").workplane(offset=wall).center(s.x_mm, s.y_mm).circle(s.outer_diameter_mm / 2).extrude(s.height_mm)
        base = base.union(boss)
        bore = cq.Workplane("XY").workplane(offset=wall).center(s.x_mm, s.y_mm).circle(s.hole_diameter_mm / 2).extrude(s.height_mm)
        base = base.cut(bore)

    if spec.vent_slots:
        slot_h = spec.inner_z_mm * 0.5
        z0 = wall + spec.inner_z_mm * 0.3
        pitch = 6.0
        start = -((spec.vent_slots - 1) * pitch) / 2
        for i in range(spec.vent_slots):
            y = start + i * pitch
            cutter = cq.Workplane("XY").workplane(offset=z0).center(0, y).rect(ox + 2, 3).extrude(slot_h)
            base = base.cut(cutter)

    parts = [("base", base, (0.20, 0.22, 0.26))]
    shapes: list[tuple[str, cq.Workplane]] = [("base", base)]
    if spec.lid:
        clearance = 0.2
        lid = cq.Workplane("XY").box(ox, oy, wall, centered=(True, True, False))
        if spec.corner_radius_mm > 0:
            lid = lid.edges("|Z").fillet(spec.corner_radius_mm)
        lip = (
            cq.Workplane("XY")
            .workplane(offset=-3)
            .rect(spec.inner_x_mm - 2 * clearance, spec.inner_y_mm - 2 * clearance)
            .extrude(3)
            .faces(">Z")
            .workplane()
            .rect(spec.inner_x_mm - 2 * clearance - 2 * min(wall, 2), spec.inner_y_mm - 2 * clearance - 2 * min(wall, 2))
            .cutBlind(-3)
        )
        lid = lid.union(lip).translate((0, 0, oz))
        parts.append(("lid", lid, (0.36, 0.38, 0.42)))
        shapes.append(("lid", lid))

    assy = cq.Assembly(name="enclosure_model")
    for label, wp in shapes:
        assy.add(wp, name=label)
    volume = sum(wp.val().Volume() for _, wp in shapes)
    bb = _union_bbox([wp for _, wp in shapes])
    return Result(
        family=spec.family,
        artifacts=[_step(assy, "enclosure"), _glb(parts, "enclosure")],
        metrics={
            "bbox_mm": _bbox(bb),
            "volume_mm3": round(volume, 1),
            "part_count": len(shapes),
        },
        processes=FAMILY_PROCESS[spec.family],
    )


# ---------------------------------------------------------------------------


def _bbox(bb) -> list[float]:
    return [round(bb.xlen, 3), round(bb.ylen, 3), round(bb.zlen, 3)]


def _union_bbox(wps: list[cq.Workplane]):
    bb = wps[0].val().BoundingBox()
    for wp in wps[1:]:
        bb = bb.add(wp.val().BoundingBox())
    return bb


def _metrics(solid: cq.Workplane, *, flat: tuple[float, float], thickness: float, bends: int) -> dict:
    v = solid.val()
    return {
        "bbox_mm": _bbox(v.BoundingBox()),
        "volume_mm3": round(v.Volume(), 1),
        "flat_size_mm": [round(flat[0], 3), round(flat[1], 3)],
        "thickness_mm": thickness,
        "bend_count": bends,
    }


def generate(spec) -> Result:
    if isinstance(spec, SheetPanel):
        return sheet_panel(spec)
    if isinstance(spec, LBracket):
        return l_bracket(spec)
    if isinstance(spec, Enclosure):
        return enclosure(spec)
    raise TypeError(f"unsupported spec family: {type(spec).__name__}")
