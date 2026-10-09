"""Documents every CAD result carries (workflow 01 acceptance, spec section 7.10):

    bom.json      preliminary bill of materials (fabricated panels/parts + purchased hardware)
    bom.csv       the same BOM for spreadsheets and shops
    drawing.svg   2D drawing: every flat pattern (or the printed part's views) with overall
                  dimensions, bend lines and the BOM item number
    manifest.json the spec, worker version and sha256 + size of every other artifact

All four are deterministic for a given spec (sorted keys, fixed number formatting), and
none of them is ever fed to the quote engine (only DXFs are).
"""

from __future__ import annotations

import csv
import io
import json
import math
from xml.sax.saxutils import escape

from .common import Artifact, FlatPanel, Result

BOM_VERSION = "dm-bom/1"
MANIFEST_VERSION = "dm-cad-manifest/1"


def _num(v: float) -> float:
    return round(float(v), 3)


def bom_items(result: Result) -> list[dict]:
    items: list[dict] = []
    for p in result.panels:
        items.append(
            {
                "item": len(items) + 1,
                "name": p.label,
                "kind": "fabricated",
                "quantity": p.quantity,
                "process": "laser cutting + press brake bending" if p.bend_count else "laser cutting",
                "thickness_mm": _num(p.thickness_mm),
                "flat_size_mm": [_num(p.flat_size_mm[0]), _num(p.flat_size_mm[1])],
                "bend_count": p.bend_count,
                "hole_count": p.hole_count,
                "file": p.dxf.filename,
                "notes": p.notes,
            }
        )
    for s in result.solids:
        items.append(
            {
                "item": len(items) + 1,
                "name": s["label"],
                "kind": "fabricated",
                "quantity": s["quantity"],
                "process": s["process"],
                "size_mm": [_num(v) for v in s["size_mm"]],
                "file": next((a.filename for a in result.artifacts if a.kind == "STEP"), None),
                "notes": "",
            }
        )
    for h in result.hardware:
        items.append({"item": len(items) + 1, "name": h["name"], "kind": "purchased", "quantity": h["quantity"], "spec": h.get("spec", ""), "notes": h.get("notes", "")})
    return items


def _bom_json(result: Result, items: list[dict]) -> Artifact:
    body = {"version": BOM_VERSION, "family": result.family, "units": "mm", "items": items}
    return Artifact("BOM", "bom.json", "application/json", (json.dumps(body, indent=2, sort_keys=True) + "\n").encode("utf-8"))


def _bom_csv(items: list[dict]) -> Artifact:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["item", "name", "kind", "quantity", "process", "thickness_mm", "size_mm", "file", "spec", "notes"])
    for it in items:
        size = it.get("flat_size_mm") or it.get("size_mm") or []
        w.writerow(
            [
                it["item"],
                it["name"],
                it["kind"],
                it["quantity"],
                it.get("process", ""),
                "" if it.get("thickness_mm") is None else f"{it['thickness_mm']:g}",
                " x ".join(f"{v:g}" for v in size),
                it.get("file") or "",
                it.get("spec", ""),
                it.get("notes", ""),
            ]
        )
    return Artifact("CSV", "bom.csv", "text/csv", buf.getvalue().encode("utf-8"))


# ---------------------------------------------------------------------------
# SVG drawing
# ---------------------------------------------------------------------------

_MARGIN = 20.0
_GAP = 36.0
_STYLE = (
    "<style>"
    ".cut{fill:none;stroke:#111;stroke-width:0.35}"
    ".bend{fill:none;stroke:#c0392b;stroke-width:0.3;stroke-dasharray:4 2}"
    ".dim{fill:none;stroke:#2c6fbb;stroke-width:0.25}"
    ".t{font-family:Helvetica,Arial,sans-serif;font-size:4px;fill:#111}"
    ".d{font-family:Helvetica,Arial,sans-serif;font-size:3.5px;fill:#2c6fbb}"
    "</style>"
)


def _f(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def _panel_paths(panel: FlatPanel, ox: float, oy: float, height: float) -> list[str]:
    """SVG elements for a DXF flat pattern drawn with its lower-left corner at (ox, oy + height) (y flipped)."""
    out: list[str] = []

    def pt(x: float, y: float) -> str:
        return f"{_f(ox + x)} {_f(oy + height - y)}"

    for e in panel.doc.modelspace():
        layer = e.dxf.layer
        cls = "bend" if "BEND" in layer.upper() else "cut"
        t = e.dxftype()
        if t == "LINE":
            out.append(f'<path class="{cls}" d="M {pt(e.dxf.start.x, e.dxf.start.y)} L {pt(e.dxf.end.x, e.dxf.end.y)}"/>')
        elif t == "CIRCLE":
            c, r = e.dxf.center, e.dxf.radius
            out.append(f'<circle class="{cls}" cx="{_f(ox + c.x)}" cy="{_f(oy + height - c.y)}" r="{_f(r)}"/>')
        elif t == "LWPOLYLINE":
            pts = list(e.get_points("xyb"))
            if not pts:
                continue
            d = [f"M {pt(pts[0][0], pts[0][1])}"]
            n = len(pts)
            for i in range(n if e.closed else n - 1):
                x0, y0, b = pts[i]
                x1, y1, _ = pts[(i + 1) % n]
                if abs(b) < 1e-12:
                    d.append(f"L {pt(x1, y1)}")
                else:
                    theta = 4 * math.atan(b)
                    chord = math.hypot(x1 - x0, y1 - y0)
                    radius = chord / (2 * abs(math.sin(theta / 2)))
                    large = 1 if abs(theta) > math.pi else 0
                    sweep = 1 if b > 0 else 0  # CCW in DXF (y up) is clockwise on screen (y down)
                    d.append(f"A {_f(radius)} {_f(radius)} 0 {large} {sweep} {pt(x1, y1)}")
            if e.closed:
                d.append("Z")
            out.append(f'<path class="{cls}" d="{" ".join(d)}"/>')
    return out


def _dims(ox: float, oy: float, w: float, h: float) -> list[str]:
    """Overall width (below) and height (right) dimension lines."""
    yb = oy + h + 6
    xr = ox + w + 6
    return [
        f'<path class="dim" d="M {_f(ox)} {_f(oy + h + 1)} L {_f(ox)} {_f(yb + 1)} M {_f(ox + w)} {_f(oy + h + 1)} L {_f(ox + w)} {_f(yb + 1)} M {_f(ox)} {_f(yb)} L {_f(ox + w)} {_f(yb)}"/>',
        f'<text class="d" x="{_f(ox + w / 2)}" y="{_f(yb + 4.5)}" text-anchor="middle">{_f(w)}</text>',
        f'<path class="dim" d="M {_f(ox + w + 1)} {_f(oy)} L {_f(xr + 1)} {_f(oy)} M {_f(ox + w + 1)} {_f(oy + h)} L {_f(xr + 1)} {_f(oy + h)} M {_f(xr)} {_f(oy)} L {_f(xr)} {_f(oy + h)}"/>',
        f'<text class="d" x="{_f(xr + 2)}" y="{_f(oy + h / 2)}" transform="rotate(90 {_f(xr + 2)} {_f(oy + h / 2)})" text-anchor="middle">{_f(h)}</text>',
    ]


def _svg(result: Result, items: list[dict], spec) -> Artifact:
    body: list[str] = []
    y = _MARGIN + 8
    max_w = 120.0
    title = f"DiscoverMake CAD · {result.family.replace('_', ' ')} · all dimensions in mm"
    body.append(f'<text class="t" x="{_f(_MARGIN)}" y="{_f(_MARGIN)}">{escape(title)}</text>')
    item_no = {it.get("file"): it["item"] for it in items if it["kind"] == "fabricated"}
    for p in result.panels:
        w, h = p.flat_size_mm
        label = f"Item {item_no.get(p.dxf.filename, '?')} · {p.label} · qty {p.quantity} · t {_f(p.thickness_mm)} · {p.dxf.filename}"
        if p.bend_count:
            label += f" · {p.bend_count} bend{'s' if p.bend_count > 1 else ''} (dashed)"
        body.append(f'<text class="t" x="{_f(_MARGIN)}" y="{_f(y)}">{escape(label)}</text>')
        if p.notes:
            body.append(f'<text class="t" x="{_f(_MARGIN)}" y="{_f(y + 5)}">{escape(p.notes)}</text>')
            y += 5
        y += 4
        body.extend(_panel_paths(p, _MARGIN, y, h))
        body.extend(_dims(_MARGIN, y, w, h))
        y += h + _GAP
        max_w = max(max_w, w + 30)
    for s in result.solids:
        sx, sy, sz = s["size_mm"]
        label = f"Item {next((it['item'] for it in items if it['name'] == s['label']), '?')} · {s['label']} · qty {s['quantity']} · {s['process']} (top and side views)"
        body.append(f'<text class="t" x="{_f(_MARGIN)}" y="{_f(y)}">{escape(label)}</text>')
        y += 4
        body.append(f'<rect class="cut" x="{_f(_MARGIN)}" y="{_f(y)}" width="{_f(sx)}" height="{_f(sy)}"/>')
        body.extend(_dims(_MARGIN, y, sx, sy))
        side_x = _MARGIN + sx + 30
        body.append(f'<rect class="cut" x="{_f(side_x)}" y="{_f(y)}" width="{_f(sx)}" height="{_f(sz)}"/>')
        body.extend(_dims(side_x, y, sx, sz))
        y += max(sy, sz) + _GAP
        max_w = max(max_w, 2 * sx + 60)
    hw = [it for it in items if it["kind"] == "purchased"]
    if hw:
        body.append(f'<text class="t" x="{_f(_MARGIN)}" y="{_f(y)}">Purchased hardware</text>')
        for it in hw:
            y += 5
            line = "Item {} · {} x {} {}".format(it["item"], it["quantity"], it["name"], it.get("spec", "")).strip()
            body.append(f'<text class="t" x="{_f(_MARGIN)}" y="{_f(y)}">{escape(line)}</text>')
        y += 8
    width, height = max_w + 2 * _MARGIN, y + _MARGIN
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_f(width)} {_f(height)}" width="{_f(width)}mm" height="{_f(height)}mm">'
        f"{_STYLE}<rect x=\"0\" y=\"0\" width=\"{_f(width)}\" height=\"{_f(height)}\" fill=\"#fff\"/>" + "".join(body) + "</svg>\n"
    )
    return Artifact("SVG", "drawing.svg", "image/svg+xml", svg.encode("utf-8"))


# ---------------------------------------------------------------------------


def _manifest(result: Result, spec, worker_version: str | None) -> Artifact:
    body = {
        "version": MANIFEST_VERSION,
        "family": result.family,
        "worker_version": worker_version,
        "spec": spec.model_dump(mode="json"),
        "units": "mm",
        "artifacts": [{"kind": a.kind, "filename": a.filename, "content_type": a.content_type, "bytes": len(a.data), "sha256": a.sha256} for a in result.artifacts],
        "panels": [{"name": p.name, "filename": p.dxf.filename, "quantity": p.quantity} for p in result.panels],
        "processes": result.processes,
    }
    return Artifact("MANIFEST", "manifest.json", "application/json", (json.dumps(body, indent=2, sort_keys=True) + "\n").encode("utf-8"))


def add_documents(result: Result, spec, *, worker_version: str | None = None) -> None:
    """Append bom.json, bom.csv, drawing.svg and (last) manifest.json to ``result.artifacts``."""
    items = bom_items(result)
    result.artifacts += [_bom_json(result, items), _bom_csv(items), _svg(result, items, spec)]
    result.artifacts.append(_manifest(result, spec, worker_version))
    result.metrics["bom_item_count"] = len(items)
