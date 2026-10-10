"""Phone stand: a side profile (base, front lip, leaning back rest, brace) extruded 70 mm wide.

angle = how far back the phone leans: low 55, medium 65, tall 75 degrees from the desk.
All walls 4-5 mm, profile corners rounded (r 2 mm). The optional name is engraved 0.8 mm into the
front of the lip. Prints on its side (profile flat on the bed) with no supports.
"""

WIDTH = 70.0
ANGLES = {"low": 55.0, "medium": 65.0, "tall": 75.0}
T = 5.0  # wall


def profile(angle_deg: float):
    """Side profile in the XY plane: x = depth (front at 0), y = height."""
    a = math.radians(angle_deg)
    depth, lip_h, groove = 90.0, 16.0, 13.0
    rest_len = 85.0
    # Back rest leans back from its foot at x = T + groove (behind the groove that holds the phone).
    fx = T + groove
    ux, uy = math.cos(a), math.sin(a)  # along the rest
    nx, ny = math.sin(a), -math.cos(a)  # rest thickness direction (towards the back)
    top_front = (fx + ux * rest_len, T + uy * rest_len)
    top_back = (top_front[0] + nx * T, top_front[1] + ny * T)
    pts = [
        (0.0, 0.0),
        (depth, 0.0),
        (depth, T),
        # brace from the back of the base up to the back of the rest, two thirds of the way up
        (fx + ux * rest_len * 0.62 + nx * T, T + uy * rest_len * 0.62 + ny * T),
        top_back,
        top_front,
        (fx, T),
        (T, T),
        (T, lip_h),
        (0.0, lip_h),
    ]
    sketch = bd.Sketch() + bd.Polygon(*pts)
    sketch = bd.fillet(sketch.vertices(), radius=2.0)
    # Lightening window under the rest: the brace triangle inset by one wall (keeps every wall >= T).
    brace = pts[3]
    window = bd.Sketch() + bd.Polygon((fx, T), (depth, T), brace)
    try:
        inner = bd.offset(window, amount=-T, kind=bd.Kind.INTERSECTION)
        inner = bd.fillet(inner.vertices(), radius=1.5)
        if inner.area > 50:
            sketch = sketch - inner
    except Exception:  # noqa: BLE001 - a solid wedge is fine too
        pass
    return sketch


@step(out="model.step")
@glb(out="model.glb")
@stl(out="model.stl")
def model():
    p = params()
    body = bd.extrude(profile(ANGLES[p.get("angle", "medium")]), amount=WIDTH)
    body = soften(body, body.edges().filter_by(bd.Axis.Z, reverse=True), radii=(1.0, 0.6, 0.3))
    if p.get("label"):
        # Front face of the lip is the plane x = 0; engrave the label into it, centred.
        text = label_face(p["label"], 9.0, WIDTH - 10, 11.0)
        cutter = bd.extrude(text, amount=0.8)
        # Rotating -90 about Y maps the text's reading direction (+X) to +Z and its extrusion to -X.
        cutter = bd.Location((0.8, 8.0, WIDTH / 2), (0, -90, 0)) * cutter
        body = body - cutter
    return finish(body, p["color"])


if __name__ == "__main__":
    model()
