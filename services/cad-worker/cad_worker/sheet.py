"""Bent sheet-metal families: U-channel, multi-bend bracket (Z / hat), slotted plate and
the sheet-metal enclosure.

One profile engine (``bent_part``) builds every bent part from flange OUTSIDE lengths and
+/-90 degree bends. It returns the folded solid (CadQuery) and the flat pattern (ezdxf) from
the same numbers, so the two always agree:

    flat segment  = flange - (r + t) per adjacent bend
    bend allowance = (pi / 2) * (r + k * t)
    bend line      = middle of each bend zone, on layer BEND_90_UP / BEND_90_DOWN

Flat-pattern frame: x across the part width (along the bend lines), y along the profile
from the first flange's free edge.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cadquery as cq

from .common import FlatPanel, Result, dxf_artifact, dxf_doc, glb_artifact, rounded_rect, solid_metrics, step_artifact, union_bbox, bbox_list
from .specs import (
    FAMILY_PROCESS,
    FlangeHole,
    MultiBendBracket,
    SheetEnclosure,
    SlottedPlate,
    UChannel,
    bend_allowance,
    check_bent_profile,
    lid_gap_mm,
    slot_ends,
)

STEEL_GREY = (0.72, 0.74, 0.78)


@dataclass
class BentPart:
    solid: cq.Workplane
    doc: object  # ezdxf Drawing
    flats: list[float]
    bend_allowance: float
    bend_lines_y: list[float]
    flat_size: tuple[float, float]


def _d(h: float) -> tuple[float, float]:
    return (math.cos(h), math.sin(h))


def _n(h: float) -> tuple[float, float]:
    """Left normal of heading h."""
    return (-math.sin(h), math.cos(h))


def _add(p, v, s: float = 1.0):
    return (p[0] + v[0] * s, p[1] + v[1] * s)


def bent_part(
    flanges: list[float],
    angles: list[int],
    width: float,
    t: float,
    r: float,
    k: float,
    holes: list[FlangeHole],
    *,
    start_heading_deg: float = 0.0,
) -> BentPart:
    """Folded solid + flat-pattern DXF for a 90-degree bend profile.

    The section is drawn in the XZ plane (local x = X, local y = Z) along a mid-line that
    starts at the origin heading ``start_heading_deg``; it is extruded along +Y by ``width``.
    +90 turns left (counter-clockwise in XZ), -90 turns right.
    """
    flats = check_bent_profile(flanges, angles, width, t, r, k, holes)
    ba = bend_allowance(r, t, k)
    setback = r + t
    rm = r + t / 2  # mid-line radius

    pos = (0.0, 0.0)
    h = math.radians(start_heading_deg)
    left: list[tuple] = []  # ("line", end) | ("arc", mid, end)
    right: list[tuple] = []
    left_start = _add(pos, _n(h), t / 2)
    right_start = _add(pos, _n(h), -t / 2)
    frames: list[tuple[tuple[float, float], float]] = []
    for i, length in enumerate(flats):
        frames.append((pos, h))
        end = _add(pos, _d(h), length)
        left.append(("line", _add(end, _n(h), t / 2)))
        right.append(("line", _add(end, _n(h), -t / 2)))
        pos = end
        if i < len(angles):
            s = 1 if angles[i] > 0 else -1
            c = _add(pos, _n(h), s * rm)

            def at(hh: float, off: float, c=c, s=s):
                p = _add(c, _n(hh), -s * rm)
                return _add(p, _n(hh), off)

            h_mid, h_end = h + s * math.pi / 4, h + s * math.pi / 2
            left.append(("arc", at(h_mid, t / 2), at(h_end, t / 2)))
            right.append(("arc", at(h_mid, -t / 2), at(h_end, -t / 2)))
            pos = _add(c, _n(h_end), -s * rm)
            h = h_end

    wp = cq.Workplane("XZ").moveTo(*left_start)
    for op in left:
        wp = wp.lineTo(*op[1]) if op[0] == "line" else wp.threePointArc(op[1], op[2])
    right_points = [right_start] + [op[-1] for op in right]
    wp = wp.lineTo(*right_points[-1])
    for idx in range(len(right) - 1, -1, -1):
        op, target = right[idx], right_points[idx]
        wp = wp.lineTo(*target) if op[0] == "line" else wp.threePointArc(op[1], target)
    # XZ normal is -Y, so extrude(-width) runs towards +Y: the part spans y in [0, width].
    solid = wp.close().extrude(-width)

    for hole in holes:
        p0, hf = frames[hole.flange]
        start = 0.0 if hole.flange == 0 else setback
        mid = _add(p0, _d(hf), hole.y_mm - start)
        nx, nz = _n(hf)
        base = cq.Vector(mid[0] - nx * 1.5 * t, hole.x_mm, mid[1] - nz * 1.5 * t)
        cyl = cq.Solid.makeCylinder(hole.diameter_mm / 2, 3 * t, base, cq.Vector(nx, 0, nz))
        solid = solid.cut(cyl)

    # Flat pattern.
    total = sum(flats) + ba * len(angles)
    doc = dxf_doc()
    msp = doc.modelspace()
    rounded_rect(msp, width, total, 0)
    seg_start: list[float] = []
    y = 0.0
    bend_lines: list[float] = []
    for i, length in enumerate(flats):
        seg_start.append(y)
        y += length
        if i < len(angles):
            bend_lines.append(y + ba / 2)
            y += ba
    for i, by in enumerate(bend_lines):
        layer = "BEND_90_UP" if angles[i] > 0 else "BEND_90_DOWN"
        if layer not in doc.layers:
            doc.layers.add(layer, color=1 if angles[i] > 0 else 5)
        msp.add_line((0, by), (width, by), dxfattribs={"layer": layer})
    for hole in holes:
        start = 0.0 if hole.flange == 0 else setback
        msp.add_circle((hole.x_mm, seg_start[hole.flange] + hole.y_mm - start), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})

    return BentPart(solid=solid, doc=doc, flats=flats, bend_allowance=ba, bend_lines_y=bend_lines, flat_size=(width, total))


def _bent_metrics(part: BentPart, t: float, bends: int) -> dict:
    return {
        **solid_metrics(part.solid, flat=part.flat_size, thickness=t, bends=bends),
        "flat_pattern": {
            "flat_segments_mm": [round(f, 3) for f in part.flats],
            "bend_allowance_mm": round(part.bend_allowance, 3),
            "bend_lines_y_mm": [round(b, 3) for b in part.bend_lines_y],
        },
    }


def _radius_warning(r: float, t: float) -> list[str]:
    return ["Inside bend radius is below the material thickness; many shops need r >= t."] if r < t else []


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------


def u_channel(spec: UChannel) -> Result:
    t, r = spec.thickness_mm, spec.inside_bend_radius_mm
    part = bent_part(spec.flanges(), spec.angles(), spec.length_mm, t, r, spec.k_factor, list(spec.holes), start_heading_deg=-90)
    dxf = dxf_artifact(part.doc, "channel_flat")
    return Result(
        family=spec.family,
        artifacts=[dxf, step_artifact(part.solid, "channel"), glb_artifact([("channel", part.solid, STEEL_GREY)], "channel")],
        metrics=_bent_metrics(part, t, 2),
        processes=FAMILY_PROCESS[spec.family],
        warnings=_radius_warning(r, t),
        panels=[FlatPanel("channel", "U-channel", 1, part.doc, dxf, part.flat_size, t, 2, len(spec.holes))],
    )


def multi_bend_bracket(spec: MultiBendBracket) -> Result:
    t, r = spec.thickness_mm, spec.inside_bend_radius_mm
    part = bent_part(list(spec.flanges_mm), list(spec.bend_angles_deg), spec.width_mm, t, r, spec.k_factor, list(spec.holes))
    dxf = dxf_artifact(part.doc, "bracket_flat")
    bends = len(spec.bend_angles_deg)
    shape = _profile_name(list(spec.bend_angles_deg))
    return Result(
        family=spec.family,
        artifacts=[dxf, step_artifact(part.solid, "bracket"), glb_artifact([("bracket", part.solid, STEEL_GREY)], "bracket")],
        metrics={**_bent_metrics(part, t, bends), "profile": shape},
        processes=FAMILY_PROCESS[spec.family],
        warnings=_radius_warning(r, t),
        panels=[FlatPanel("bracket", f"{shape.capitalize()} bracket", 1, part.doc, dxf, part.flat_size, t, bends, len(spec.holes))],
    )


def _profile_name(angles: list[int]) -> str:
    if angles == [90, -90] or angles == [-90, 90]:
        return "z-profile"
    if angles in ([90, -90, -90, 90], [-90, 90, 90, -90]):
        return "hat-profile"
    if len(set(angles)) == 1 and len(angles) == 2:
        return "u-profile"
    return f"{len(angles)}-bend profile"


def slotted_plate(spec: SlottedPlate) -> Result:
    w, h, t = spec.width_mm, spec.height_mm, spec.thickness_mm
    solid = cq.Workplane("XY").rect(w, h, centered=False).extrude(t)
    if spec.corner_radius_mm > 0:
        solid = solid.edges("|Z").fillet(spec.corner_radius_mm)
    for hole in spec.holes:
        solid = solid.cut(cq.Workplane("XY").center(hole.x_mm, hole.y_mm).circle(hole.diameter_mm / 2).extrude(t))
    for s in spec.slots:
        cutter = cq.Workplane("XY").center(s.x_mm, s.y_mm).slot2D(s.length_mm, s.width_mm, s.angle_deg).extrude(t)
        solid = solid.cut(cutter)
    for c in spec.countersinks:
        # Through bore plus the cone, opening at the top face (z = t).
        bore = cq.Solid.makeCylinder(c.through_diameter_mm / 2, t, cq.Vector(c.x_mm, c.y_mm, 0), cq.Vector(0, 0, 1))
        depth = c.depth()
        cone = cq.Solid.makeCone(c.through_diameter_mm / 2, c.head_diameter_mm / 2, depth, cq.Vector(c.x_mm, c.y_mm, t - depth), cq.Vector(0, 0, 1))
        solid = solid.cut(bore).cut(cone)

    doc = dxf_doc()
    msp = doc.modelspace()
    rounded_rect(msp, w, h, spec.corner_radius_mm)
    for hole in spec.holes:
        msp.add_circle((hole.x_mm, hole.y_mm), hole.diameter_mm / 2, dxfattribs={"layer": "CUT"})
    for s in spec.slots:
        a, b = slot_ends(s)
        ang = math.radians(s.angle_deg)
        nx, ny = -math.sin(ang) * s.width_mm / 2, math.cos(ang) * s.width_mm / 2
        # Obround: straight side, half circle, straight side, half circle (bulge 1 = 180 degrees CCW).
        pts = [(a[0] - nx, a[1] - ny, 0), (b[0] - nx, b[1] - ny, 1), (b[0] + nx, b[1] + ny, 0), (a[0] + nx, a[1] + ny, 1)]
        msp.add_lwpolyline(pts, format="xyb", close=True, dxfattribs={"layer": "CUT"})
    # Countersinks: the DXF cuts the through-diameter; the cone is a secondary operation.
    for c in spec.countersinks:
        msp.add_circle((c.x_mm, c.y_mm), c.through_diameter_mm / 2, dxfattribs={"layer": "CUT"})

    dxf = dxf_artifact(doc, "plate_flat")
    feature_count = len(spec.holes) + len(spec.slots) + len(spec.countersinks)
    notes = ""
    if spec.countersinks:
        sizes = sorted({(c.through_diameter_mm, c.head_diameter_mm, c.angle_deg) for c in spec.countersinks})
        notes = "Countersink " + "; ".join(f"{len([c for c in spec.countersinks if (c.through_diameter_mm, c.head_diameter_mm, c.angle_deg) == sz])}x d{sz[0]:g} to d{sz[1]:g} x {sz[2]}deg" for sz in sizes)
    return Result(
        family=spec.family,
        artifacts=[dxf, step_artifact(solid, "plate"), glb_artifact([("plate", solid, STEEL_GREY)], "plate")],
        metrics={
            **solid_metrics(solid, flat=(w, h), thickness=t, bends=0),
            "hole_count": len(spec.holes),
            "slot_count": len(spec.slots),
            "countersink_count": len(spec.countersinks),
            "countersinks": [
                {"x_mm": c.x_mm, "y_mm": c.y_mm, "through_diameter_mm": c.through_diameter_mm, "head_diameter_mm": c.head_diameter_mm, "angle_deg": c.angle_deg, "depth_mm": round(c.depth(), 3)}
                for c in spec.countersinks
            ],
        },
        processes=FAMILY_PROCESS[spec.family] if spec.countersinks else ["laser cutting"],
        panels=[FlatPanel("plate", "Slotted plate", 1, doc, dxf, (w, h), t, 0, feature_count, notes)],
    )


# ---------------------------------------------------------------------------
# Sheet-metal enclosure
# ---------------------------------------------------------------------------

RIVET_HOLE_MM = 3.3  # 1/8" (3.2 mm) blind rivet
SCREW_HOLE_MM = 3.4  # M3 clearance
CLEARANCE_MM = 0.5  # lid lip to wall, each side

def _place(wp: cq.Workplane, *, rot: tuple[tuple[float, float, float], float] | None = None, rot2: tuple[tuple[float, float, float], float] | None = None, at: tuple[float | None, float | None, float | None]) -> cq.Workplane:
    """Rotate about the origin, then translate so the bbox minimum (or max for negative axes) lands on ``at``."""
    if rot:
        wp = wp.rotate((0, 0, 0), rot[0], rot[1])
    if rot2:
        wp = wp.rotate((0, 0, 0), rot2[0], rot2[1])
    bb = wp.val().BoundingBox()
    dx = 0 if at[0] is None else at[0] - bb.xmin
    dy = 0 if at[1] is None else at[1] - bb.ymin
    dz = 0 if at[2] is None else at[2] - bb.zmin
    return wp.translate((dx, dy, dz))


def sheet_enclosure(spec: SheetEnclosure) -> Result:
    t, r, k = spec.thickness_mm, spec.inside_bend_radius_mm, spec.k_factor
    setback = r + t
    ix, iy, iz = spec.inner_x_mm, spec.inner_y_mm, spec.inner_z_mm
    body_len = ix + 2 * t  # end caps sit inside the body ends
    wall_h = iz + t  # outside height of a side wall
    ef, ll = spec.end_flange_mm, spec.lid_lip_mm
    flange_hole_y = (ef - setback) / 2  # centre of the end-cap flange flat, from its free edge
    lip_hole_y = (ll - setback) / 2

    # Fastener positions (assembly frame: body length along +Y from 0, floor outer face at z = 0).
    rivet_z = [t + iz / 3, t + 2 * iz / 3]  # heights above the floor's outer face
    lid_screw_y = [body_len / 4, 3 * body_len / 4]
    gap = lid_gap_mm(r)
    lid_top = iz + 2 * t + gap
    lid_screw_z = lid_top - ll + lip_hole_y  # lip free edge + half the lip flat
    # End caps stand r above the floor (clear of the floor bend; the gasket seals the gap).
    cap_z0, cap_len = t + r, iz - r
    cap_rivet_y_near = ef - flange_hole_y  # from the body end, into the box

    # Body: U-channel, floor = base, walls = flanges; length along the body.
    # Wall A (flange 0) is measured down from its free edge; wall B (flange 2) up from the floor's outer face.
    def wall_y(wall: int, z: float) -> float:
        return round(wall_h - z if wall == 0 else z, 4)

    body_holes: list[FlangeHole] = []
    for wall in (0, 2):
        for along in (cap_rivet_y_near, body_len - cap_rivet_y_near):
            for z in rivet_z:
                body_holes.append(FlangeHole(flange=wall, x_mm=round(along, 4), y_mm=wall_y(wall, z), diameter_mm=RIVET_HOLE_MM))
        for along in lid_screw_y:
            body_holes.append(FlangeHole(flange=wall, x_mm=round(along, 4), y_mm=wall_y(wall, lid_screw_z), diameter_mm=SCREW_HOLE_MM))
    for hole in spec.floor_holes:
        body_holes.append(FlangeHole(flange=1, x_mm=round(t + hole.x_mm, 4), y_mm=round(t + hole.y_mm, 4), diameter_mm=hole.diameter_mm))
    body = bent_part([wall_h, iy + 2 * t, wall_h], [90, 90], body_len, t, r, k, body_holes, start_heading_deg=-90)

    # End caps: U-channel whose base is the end plate (between the walls), flanges riveted to the walls.
    def cap_holes(gland: bool) -> list[FlangeHole]:
        # Same distance from each flange's free edge (flange 2 is measured from the plate's outer face).
        holes = [FlangeHole(flange=f, x_mm=round(z - cap_z0, 4), y_mm=round(flange_hole_y if f == 0 else ef - flange_hole_y, 4), diameter_mm=RIVET_HOLE_MM) for f in (0, 2) for z in rivet_z]
        if gland and spec.gland_diameter_mm:
            holes.append(FlangeHole(flange=1, x_mm=round(cap_len / 2, 4), y_mm=round(iy / 2, 4), diameter_mm=spec.gland_diameter_mm))
        return holes

    cap_plain = bent_part([ef, iy, ef], [90, 90], cap_len, t, r, k, cap_holes(False), start_heading_deg=-90)
    cap_gland = bent_part([ef, iy, ef], [90, 90], cap_len, t, r, k, cap_holes(True), start_heading_deg=-90) if spec.gland_diameter_mm else None

    # Lid: inverted U whose lips overlap the walls on the outside.
    lid_base = iy + 4 * t + 2 * CLEARANCE_MM
    lid_holes = [FlangeHole(flange=f, x_mm=round(y, 4), y_mm=round(lip_hole_y if f == 0 else ll - lip_hole_y, 4), diameter_mm=SCREW_HOLE_MM) for f in (0, 2) for y in lid_screw_y]
    lid = bent_part([ll, lid_base, ll], [-90, -90], body_len, t, r, k, lid_holes, start_heading_deg=90)

    # Assembly placement.
    body_wp = _place(body.solid, at=(0, 0, 0))
    # Cap extrusion (+Y) becomes +Z; its opening (+Z) becomes -Y (flanges point into the box).
    cap_far = _place((cap_gland or cap_plain).solid, rot=((1, 0, 0), 90), at=(t, None, cap_z0))
    cap_far = cap_far.translate((0, body_len - cap_far.val().BoundingBox().ymax, 0))
    cap_near = _place(cap_plain.solid, rot=((1, 0, 0), 90), rot2=((0, 0, 1), 180), at=(t, 0, cap_z0))
    lid_wp = _place(lid.solid, at=(-(t + CLEARANCE_MM), 0, None))
    lid_wp = lid_wp.translate((0, 0, lid_top - lid_wp.val().BoundingBox().zmax))

    shapes = [("body", body_wp), ("end_cap_1", cap_near), ("end_cap_2", cap_far), ("lid", lid_wp)]
    assy = cq.Assembly(name="sheet_enclosure_model")
    for label, wp in shapes:
        assy.add(wp, name=label)
    colors = {"body": (0.62, 0.66, 0.70), "end_cap_1": (0.50, 0.54, 0.58), "end_cap_2": (0.50, 0.54, 0.58), "lid": (0.80, 0.82, 0.85)}

    body_dxf = dxf_artifact(body.doc, "body_flat")
    cap_dxf = dxf_artifact(cap_plain.doc, "end_cap_flat")
    lid_dxf = dxf_artifact(lid.doc, "lid_flat")
    panels = [
        FlatPanel("body", "Body (floor + side walls)", 1, body.doc, body_dxf, body.flat_size, t, 2, len(body_holes)),
        FlatPanel("end_cap", "End cap", 2 if cap_gland is None else 1, cap_plain.doc, cap_dxf, cap_plain.flat_size, t, 2, len(cap_holes(False))),
    ]
    artifacts = [body_dxf, cap_dxf]
    if cap_gland is not None:
        gland_dxf = dxf_artifact(cap_gland.doc, "end_cap_gland_flat")
        panels.append(FlatPanel("end_cap_gland", "End cap with cable-gland hole", 1, cap_gland.doc, gland_dxf, cap_gland.flat_size, t, 2, len(cap_holes(True))))
        artifacts.append(gland_dxf)
    panels.append(FlatPanel("lid", "Lid with drip lips", 1, lid.doc, lid_dxf, lid.flat_size, t, 2, len(lid_holes)))
    artifacts.append(lid_dxf)
    artifacts += [step_artifact(assy, "enclosure"), glb_artifact([(label, wp, colors[label]) for label, wp in shapes], "enclosure")]

    gasket_m = round(2 * (body_len + iy + 2 * t) / 1000 + 2 * (iy + iz) / 1000, 3)
    hardware = [
        {"name": "Blind rivet, aluminium, 1/8 in (3.2 mm)", "quantity": 8, "spec": f"grip {round(2 * t, 2)} mm", "notes": "End caps to body side walls."},
        {"name": "Machine screw M3 x 8, stainless, pan head", "quantity": 4, "spec": "ISO 7045 A2", "notes": "Lid lips to body side walls."},
        {"name": "Nyloc nut M3, stainless", "quantity": 4, "spec": "ISO 10511 A2", "notes": "Inside the side walls."},
        {"name": "EPDM foam gasket strip, 10 x 3 mm, adhesive-backed", "quantity": 1, "spec": f"{gasket_m} m", "notes": "Under the lid and around both end caps (weather seal)."},
    ]
    if spec.gland_diameter_mm:
        hardware.append({"name": "Cable gland, IP68, nylon", "quantity": 1, "spec": f"for a {spec.gland_diameter_mm:g} mm hole", "notes": "In the second end cap."})

    bb = union_bbox([wp for _, wp in shapes])
    volume = sum(wp.val().Volume() for _, wp in shapes)
    area = sum(wp.val().Area() for _, wp in shapes)
    return Result(
        family=spec.family,
        artifacts=artifacts,
        metrics={
            "bbox_mm": bbox_list(bb),
            "volume_mm3": round(volume, 1),
            "surface_area_mm2": round(area, 1),
            "part_count": len(shapes),
            "thickness_mm": t,
            "bend_count": 2 * len(shapes),
            "panels": [
                {"name": p.name, "label": p.label, "filename": p.dxf.filename, "quantity": p.quantity, "flat_size_mm": [round(p.flat_size_mm[0], 3), round(p.flat_size_mm[1], 3)], "bend_count": p.bend_count, "hole_count": p.hole_count}
                for p in panels
            ],
            "cavity_mm": [ix, iy, iz],
        },
        processes=FAMILY_PROCESS[spec.family],
        warnings=_radius_warning(r, t) + ["Weatherproofing relies on the gasket and the lid drip lips; specify an IP rating test if one is required."],
        panels=panels,
        hardware=hardware,
    )
