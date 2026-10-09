"""Shared artifact types and exporters for every CAD family.

Sheet-metal DXFs follow the DiscoverMake quote-engine conventions
(``src/server/quote/dxf/parse.ts``): millimetres ($INSUNITS = 4), cut geometry
on layer ``CUT``, bend lines on a layer containing ``BEND`` with the angle in its
name (``BEND_90``, ``BEND_90_UP``, ``BEND_90_DOWN``). The quote engine treats any
other non-annotation layer as cut geometry, so nothing else is ever written to a DXF.
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

INSUNITS_MM = 4

# Deterministic DXF output: fixed creation/update timestamps and GUIDs, so the same
# spec always yields the same bytes (and sha256). Golden files and caching rely on it.
ezdxf.options.write_fixed_meta_data_for_testing = True


@dataclass
class Artifact:
    kind: str  # STEP | DXF | GLB | BOM | CSV | SVG | MANIFEST
    filename: str
    content_type: str
    data: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()

    def to_json(self) -> dict:
        return {
            "kind": self.kind,
            "filename": self.filename,
            "content_type": self.content_type,
            "bytes": len(self.data),
            "sha256": self.sha256,
            "content_base64": base64.b64encode(self.data).decode("ascii"),
        }


@dataclass
class FlatPanel:
    """One flat pattern of a sheet-metal result (used for the BOM, drawing and manifest)."""

    name: str
    label: str
    quantity: int
    doc: "ezdxf.document.Drawing"
    dxf: Artifact
    flat_size_mm: tuple[float, float]
    thickness_mm: float
    bend_count: int
    hole_count: int
    notes: str = ""


@dataclass
class Result:
    family: str
    artifacts: list[Artifact]
    metrics: dict
    processes: list[str]
    warnings: list[str] = field(default_factory=list)
    #: Flat patterns (sheet families) in BOM order.
    panels: list[FlatPanel] = field(default_factory=list)
    #: Purchased hardware lines for the BOM: {name, quantity, spec, notes}.
    hardware: list[dict] = field(default_factory=list)
    #: Fabricated non-sheet parts (3D print / CNC): {name, label, quantity, process, size_mm}.
    solids: list[dict] = field(default_factory=list)

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


def step_artifact(shape: cq.Workplane | cq.Assembly, name: str) -> Artifact:
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, f"{name}.step")
        if isinstance(shape, cq.Assembly):
            shape.export(path, "STEP")
        else:
            cq.exporters.export(shape, path, cq.exporters.ExportTypes.STEP)
        with open(path, "rb") as f:
            return Artifact("STEP", f"{name}.step", "model/step", f.read())


def glb_artifact(parts: list[tuple[str, cq.Workplane, tuple[float, float, float]]], name: str) -> Artifact:
    assy = cq.Assembly(name=f"{name}_model")
    for label, wp, color in parts:
        assy.add(wp, name=label, color=cq.Color(*color))
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, f"{name}.glb")
        assy.export(path, "GLTF", binary=True)
        with open(path, "rb") as f:
            return Artifact("GLB", f"{name}.glb", "model/gltf-binary", f.read())


def dxf_doc() -> "ezdxf.document.Drawing":
    doc = ezdxf.new("R2010", setup=False)
    doc.header["$INSUNITS"] = INSUNITS_MM
    doc.header["$MEASUREMENT"] = 1
    doc.layers.add("CUT", color=7)
    return doc


def dxf_artifact(doc: "ezdxf.document.Drawing", name: str) -> Artifact:
    buf = io.StringIO()
    doc.write(buf)
    return Artifact("DXF", f"{name}.dxf", "application/dxf", buf.getvalue().encode("utf-8"))


def rounded_rect(msp, w: float, h: float, r: float) -> None:
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


def bbox_list(bb) -> list[float]:
    return [round(bb.xlen, 3), round(bb.ylen, 3), round(bb.zlen, 3)]


def union_bbox(wps: list[cq.Workplane]):
    bb = wps[0].val().BoundingBox()
    for wp in wps[1:]:
        bb = bb.add(wp.val().BoundingBox())
    return bb


def solid_metrics(solid: cq.Workplane, *, flat: tuple[float, float], thickness: float, bends: int) -> dict:
    v = solid.val()
    return {
        "bbox_mm": bbox_list(v.BoundingBox()),
        "volume_mm3": round(v.Volume(), 1),
        "flat_size_mm": [round(flat[0], 3), round(flat[1], 3)],
        "thickness_mm": thickness,
        "bend_count": bends,
    }
