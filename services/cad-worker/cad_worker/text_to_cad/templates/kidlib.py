# --- kidlib: shared helpers for the Kids & Family templates (prepended to each template) ---
# Our own code, trusted, but run through the same sandbox as Make AI scripts. Parameters arrive
# as DATA in params.json next to the model (validated by the worker before the build): no value
# is ever pasted into this source. Labels are letters, digits and spaces only.
import json
import math
from pathlib import Path

from cadgen import build123d as bd
from cadgen import glb, step, stl

HERE = Path(__file__).resolve().parent
FONT = HERE / "label-font.ttf"
#: Kid-safe printable sizes: no wall under this (mm).
MIN_WALL_MM = 1.6
COLORS = {
    "red": (0.86, 0.16, 0.16),
    "orange": (0.96, 0.52, 0.12),
    "yellow": (0.98, 0.82, 0.16),
    "green": (0.2, 0.66, 0.3),
    "blue": (0.16, 0.42, 0.86),
    "purple": (0.52, 0.28, 0.78),
    "black": (0.12, 0.12, 0.13),
    "white": (0.94, 0.94, 0.94),
}


def params() -> dict:
    return json.loads((HERE / "params.json").read_text("utf-8"))


def label_face(text: str, size: float, max_width: float, max_height: float):
    """The label as a flat face centred on the origin, shrunk to fit max_width x max_height."""
    face = bd.Text(text, font_size=size, font_path=str(FONT), align=(bd.Align.CENTER, bd.Align.CENTER))
    bb = face.bounding_box()
    scale = min(1.0, max_width / max(bb.size.X, 1e-6), max_height / max(bb.size.Y, 1e-6))
    if scale < 1.0:
        face = bd.Text(text, font_size=size * scale, font_path=str(FONT), align=(bd.Align.CENTER, bd.Align.CENTER))
    return face


def soften(shape, edges, radii=(1.0, 0.6, 0.3)):
    """Round the given edges with the largest radius the kernel accepts (no sharp edges)."""
    for r in radii:
        try:
            out = bd.fillet(edges, radius=r)
            if out is not None and out.is_valid:
                return out
        except Exception:  # noqa: BLE001 - try the next, smaller radius
            continue
    return shape


def finish(shape, color: str):
    """One solid, coloured for the 3D preview, labelled."""
    solids = shape.solids()
    if len(solids) > 1:
        shape = solids.sort_by(bd.SortBy.VOLUME)[-1].fuse(*solids.sort_by(bd.SortBy.VOLUME)[:-1]).clean()
    rgb = COLORS.get(color, COLORS["blue"])
    shape.color = bd.Color(*rgb)
    shape.label = "kid_project"
    return shape


# --- template ---
