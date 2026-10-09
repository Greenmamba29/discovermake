"""R6 Reconstruct: printed replacement parts (round knob, spacer / bushing).

Both are modelled in their print orientation (+Z up, the face on the bed at z = 0):

* ``round_knob``: bore-down. The shaft bore opens on the bed face, so its ceiling is the only
  bridge (span = bore diameter); the top chamfer, grip flutes and pointer notch need no support.
* ``spacer_bushing``: flange-down. Nothing overhangs.

Every result carries STEP (CAD), STL (the print farm's file, millimetres), GLB (preview) and
the usual BOM / drawing / manifest. Metrics add ``surface_area_mm2`` and ``min_wall_mm`` for
the print quote engine (material and machine time come from volume and area; DFM from the
wall), plus ``bridge_span_mm`` for the overhang note.
"""

from __future__ import annotations

import math

import cadquery as cq

from .common import Result, glb_artifact, step_artifact, stl_artifact
from .specs import FAMILY_PROCESS, POINTER_NOTCH_DEPTH_MM, POINTER_NOTCH_WIDTH_MM, RoundKnob, SpacerBushing

PRINT_GREY = (0.23, 0.25, 0.29)
PRINT_PROCESS_LABEL = "3D printing (FDM or SLS)"


def _metrics(solid: cq.Workplane, bbox: tuple[float, float, float], **extra) -> dict:
    """``bbox`` is the exact envelope from the spec (OCCT's box pads curved faces by its tolerance)."""
    v = solid.val()
    return {
        "bbox_mm": [round(b, 3) for b in bbox],
        "volume_mm3": round(v.Volume(), 1),
        "surface_area_mm2": round(v.Area(), 1),
        "part_count": 1,
        **extra,
    }


def _bore(spec: RoundKnob) -> cq.Workplane:
    br = spec.bore_diameter() / 2
    bore = cq.Workplane("XY").circle(br).extrude(spec.bore_depth_mm)
    if spec.bore_type == "d_shaft":
        # The shaft's flat sits (r - flat depth) from its axis; the bore keeps the same flat,
        # moved out by half the fit clearance.
        flat_x = spec.shaft_diameter_mm / 2 - (spec.shaft_flat_depth_mm or 0) + spec.bore_clearance_mm / 2
        keep = cq.Workplane("XY").box(flat_x + br + 1, 2 * br + 2, spec.bore_depth_mm, centered=False).translate((-br - 1, -br - 1, 0))
        bore = bore.intersect(keep)
    return bore


def round_knob(spec: RoundKnob) -> Result:
    r, h = spec.diameter_mm / 2, spec.height_mm
    body = cq.Workplane("XY").circle(r).extrude(h)
    if spec.chamfer_mm > 0:
        body = body.faces(">Z").edges().chamfer(spec.chamfer_mm)
    if spec.grip_ribs:
        cutter = None
        for i in range(spec.grip_ribs):
            a = 2 * math.pi * i / spec.grip_ribs
            flute = cq.Workplane("XY").center(r * math.cos(a), r * math.sin(a)).circle(spec.rib_depth_mm).extrude(h)
            cutter = flute if cutter is None else cutter.union(flute)
        body = body.cut(cutter)
    body = body.cut(_bore(spec))
    if spec.pointer_notch:
        start = 0.25 * r
        notch = cq.Workplane("XY").box(r - start + 1, POINTER_NOTCH_WIDTH_MM, POINTER_NOTCH_DEPTH_MM + 1, centered=(False, True, False)).translate((start, 0, h - POINTER_NOTCH_DEPTH_MM))
        body = body.cut(notch)

    warnings: list[str] = []
    bridge = round(spec.bore_diameter(), 3)
    if bridge > 10:
        warnings.append(f"The bore ceiling bridges {bridge:g} mm; above 10 mm the printer needs support inside the bore.")
    shaft = f"{spec.shaft_diameter_mm:g} mm {'D-shaft' if spec.bore_type == 'd_shaft' else 'round shaft'}"
    return Result(
        family=spec.family,
        artifacts=[step_artifact(body, "knob"), stl_artifact(body, "knob"), glb_artifact([("knob", body, PRINT_GREY)], "knob")],
        metrics=_metrics(body, (spec.diameter_mm, spec.diameter_mm, h), min_wall_mm=spec.min_wall_mm(), bridge_span_mm=bridge, print_orientation="bore down (z = 0 on the bed)"),
        processes=FAMILY_PROCESS[spec.family],
        warnings=warnings,
        solids=[
            {
                "name": "knob",
                "label": f"Replacement knob for a {shaft}",
                "quantity": 1,
                "process": PRINT_PROCESS_LABEL,
                "size_mm": [spec.diameter_mm, spec.diameter_mm, h],
                "shape": "round",
            }
        ],
    )


def spacer_bushing(spec: SpacerBushing) -> Result:
    od, idia, length = spec.outer_diameter_mm, spec.inner_diameter_mm, spec.length_mm
    body = cq.Workplane("XY").circle(od / 2).extrude(length)
    flanged = spec.flange_diameter_mm is not None and spec.flange_thickness_mm is not None
    if flanged:
        body = body.union(cq.Workplane("XY").circle(spec.flange_diameter_mm / 2).extrude(spec.flange_thickness_mm))  # type: ignore[operator]
    body = body.cut(cq.Workplane("XY").circle(idia / 2).extrude(length))
    if spec.chamfer_mm > 0:
        body = body.faces(">Z").edges().chamfer(spec.chamfer_mm)
    outer = float(spec.flange_diameter_mm) if flanged and spec.flange_diameter_mm is not None else od
    label = f"{'Flanged bushing' if flanged else 'Spacer'} {od:g} x {idia:g} x {length:g} mm"
    return Result(
        family=spec.family,
        artifacts=[step_artifact(body, "spacer"), stl_artifact(body, "spacer"), glb_artifact([("spacer", body, PRINT_GREY)], "spacer")],
        metrics=_metrics(body, (outer, outer, length), min_wall_mm=spec.min_wall_mm(), bridge_span_mm=0.0, print_orientation="flange down (z = 0 on the bed)" if flanged else "end down (z = 0 on the bed)"),
        processes=FAMILY_PROCESS[spec.family],
        solids=[{"name": "spacer", "label": label, "quantity": 1, "process": PRINT_PROCESS_LABEL, "size_mm": [outer, outer, length], "shape": "round"}],
    )
