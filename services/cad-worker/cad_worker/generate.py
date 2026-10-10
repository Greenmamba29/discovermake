"""CadSpec -> artifacts (STEP, DXF flat patterns, GLB, BOM, drawing, manifest) with CadQuery.

Every family returns its geometry artifacts; ``generate`` then appends the
documents every build needs (workflow 01 acceptance): a BOM as JSON and CSV, an SVG
drawing with overall dimensions, and a manifest that lists the spec and the sha256 of
every other artifact.

Sheet-metal DXFs follow the DiscoverMake quote-engine conventions
(``src/server/quote/dxf/parse.ts``), see ``common.py``. That lets a generated flat
pattern go straight into the R1 instant quote engine.
"""

from __future__ import annotations

import math

import cadquery as cq

from . import outputs, printed, sheet
from .common import (
    Artifact,
    FlatPanel,
    Result,
    bbox_list,
    dxf_artifact,
    dxf_doc,
    glb_artifact,
    rounded_rect,
    solid_metrics,
    step_artifact,
    union_bbox,
)
from .specs import FAMILY_PROCESS, Enclosure, LBracket, MultiBendBracket, RoundKnob, SheetEnclosure, SheetPanel, SlottedPlate, SpacerBushing, UChannel

__all__ = ["Artifact", "Result", "bracket_flat_length", "generate"]


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

    doc = dxf_doc()
    msp = doc.modelspace()
    rounded_rect(msp, w, h, spec.corner_radius_mm)
    for hole in spec.holes:
        msp.add_circle((hole.x_mm, hole.y_mm), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})

    dxf = dxf_artifact(doc, "panel_flat")
    return Result(
        family=spec.family,
        artifacts=[dxf, step_artifact(solid, "panel"), glb_artifact([("panel", solid, (0.72, 0.74, 0.78))], "panel")],
        metrics=solid_metrics(solid, flat=(w, h), thickness=t, bends=0),
        processes=FAMILY_PROCESS[spec.family],
        panels=[FlatPanel("panel", "Panel", 1, doc, dxf, (w, h), t, 0, len(spec.holes))],
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
    doc = dxf_doc()
    doc.layers.add("BEND_90", color=1)
    msp = doc.modelspace()
    rounded_rect(msp, w, total, 0)
    bend_y = flat_a + ba / 2
    msp.add_line((0, bend_y), (w, bend_y), dxfattribs={"layer": "BEND_90"})
    for hole in spec.holes_a:
        msp.add_circle((hole.x_mm, hole.y_mm), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})
    for hole in spec.holes_b:
        msp.add_circle((hole.x_mm, total - hole.y_mm), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})

    warnings = []
    if r < t:
        warnings.append("Inside bend radius is below the material thickness; many shops need r >= t.")
    dxf = dxf_artifact(doc, "bracket_flat")
    return Result(
        family=spec.family,
        artifacts=[dxf, step_artifact(solid, "bracket"), glb_artifact([("bracket", solid, (0.72, 0.74, 0.78))], "bracket")],
        metrics={
            **solid_metrics(solid, flat=(w, total), thickness=t, bends=1),
            "flat_pattern": {"flange_a_mm": round(flat_a, 3), "bend_allowance_mm": round(ba, 3), "flange_b_mm": round(flat_b, 3), "bend_line_y_mm": round(bend_y, 3)},
        },
        processes=FAMILY_PROCESS[spec.family],
        warnings=warnings,
        panels=[FlatPanel("bracket", "L-bracket", 1, doc, dxf, (w, total), t, 1, len(spec.holes_a) + len(spec.holes_b))],
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
    area = sum(wp.val().Area() for _, wp in shapes)
    bb = union_bbox([wp for _, wp in shapes])
    solids = [{"name": "base", "label": "Enclosure base", "quantity": 1, "process": "3D printing or CNC milling", "size_mm": [round(ox, 3), round(oy, 3), round(oz, 3)]}]
    if spec.lid:
        solids.append({"name": "lid", "label": "Lip lid", "quantity": 1, "process": "3D printing or CNC milling", "size_mm": [round(ox, 3), round(oy, 3), round(wall + 3, 3)]})
    hardware = []
    if spec.standoffs and spec.lid:
        hardware.append({"name": "Self-tapping screw for the standoffs", "quantity": len(spec.standoffs), "spec": f"for a {spec.standoffs[0].hole_diameter_mm} mm pilot hole", "notes": "Size to the board's mounting holes."})
    return Result(
        family=spec.family,
        artifacts=[step_artifact(assy, "enclosure"), glb_artifact(parts, "enclosure")],
        metrics={
            "bbox_mm": bbox_list(bb),
            "volume_mm3": round(volume, 1),
            "surface_area_mm2": round(area, 1),
            "part_count": len(shapes),
        },
        processes=FAMILY_PROCESS[spec.family],
        solids=solids,
        hardware=hardware,
    )


# ---------------------------------------------------------------------------


def _family_result(spec) -> Result:
    if isinstance(spec, SheetPanel):
        return sheet_panel(spec)
    if isinstance(spec, LBracket):
        return l_bracket(spec)
    if isinstance(spec, Enclosure):
        return enclosure(spec)
    if isinstance(spec, UChannel):
        return sheet.u_channel(spec)
    if isinstance(spec, MultiBendBracket):
        return sheet.multi_bend_bracket(spec)
    if isinstance(spec, SlottedPlate):
        return sheet.slotted_plate(spec)
    if isinstance(spec, SheetEnclosure):
        return sheet.sheet_enclosure(spec)
    if isinstance(spec, RoundKnob):
        return printed.round_knob(spec)
    if isinstance(spec, SpacerBushing):
        return printed.spacer_bushing(spec)
    raise TypeError(f"unsupported spec family: {type(spec).__name__}")


def generate(spec, *, worker_version: str | None = None) -> Result:
    """Geometry for ``spec`` plus the BOM (JSON + CSV), the SVG drawing and the manifest."""
    result = _family_result(spec)
    outputs.add_documents(result, spec, worker_version=worker_version)
    return result
