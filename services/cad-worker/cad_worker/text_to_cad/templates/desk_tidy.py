"""Desk tidy: 2-4 round cups of different heights in a row on a shared base.

Cups are 50 mm across with 2.4 mm walls; neighbours share a 2.4 mm wall. The base is 3 mm with
a 16 mm front ledge that carries the optional name (raised 1 mm). Rims and the base are rounded.
"""

CUP_D, WALL, FLOOR = 50.0, 2.4, 3.0
HEIGHTS = [90.0, 72.0, 58.0, 80.0]
LEDGE = 16.0


@step(out="model.step")
@glb(out="model.glb")
@stl(out="model.stl")
def model():
    p = params()
    n = int(p.get("cups", 3))
    pitch = CUP_D - WALL
    xs = [(i - (n - 1) / 2) * pitch for i in range(n)]
    span = pitch * (n - 1) + CUP_D

    base = bd.Pos(0, -LEDGE / 2, 0) * bd.extrude(bd.RectangleRounded(span + 4, CUP_D + 4 + LEDGE, radius=8.0), amount=FLOOR)
    base = soften(base, base.edges().group_by(bd.Axis.Z)[-1], radii=(1.0, 0.6))
    body = base
    for x, h in zip(xs, HEIGHTS):
        body = body + bd.Pos(x, 0, 0) * bd.Cylinder(CUP_D / 2, h, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    for x, h in zip(xs, HEIGHTS):
        body = body - bd.Pos(x, 0, FLOOR) * bd.Cylinder(CUP_D / 2 - WALL, h, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    # Round every cup rim (top circular edges of each cup).
    rims = [e for e in body.edges() if e.geom_type == bd.GeomType.CIRCLE and e.center().Z > FLOOR + 1]
    body = soften(body, bd.ShapeList(rims), radii=(0.8, 0.5))
    if p.get("label"):
        text = label_face(p["label"], 10.0, span - 10, LEDGE - 5)
        body = body + bd.Pos(0, -CUP_D / 2 - LEDGE / 2 - 1, FLOOR) * bd.extrude(text, amount=1.0)
    return finish(body, p["color"])


if __name__ == "__main__":
    model()
