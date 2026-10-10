"""Bookmark: a 2 mm plate (150 x 40 mm) with the name raised along it.

rounded: a rounded rectangle; arrow: one end comes to a ROUNDED point (r 4 mm);
star: a rounded rectangle with a raised, rounded star near the top. The plate is 2 mm (above the
1.6 mm kid minimum), letters rise 0.8 mm.
"""

LENGTH, WIDTH, THICK, RAISE_MM = 150.0, 40.0, 2.0, 0.8


def plate(shape: str):
    if shape == "arrow":
        tip = 22.0
        pts = [
            (-LENGTH / 2, -WIDTH / 2),
            (LENGTH / 2 - tip, -WIDTH / 2),
            (LENGTH / 2, 0.0),
            (LENGTH / 2 - tip, WIDTH / 2),
            (-LENGTH / 2, WIDTH / 2),
        ]
        sketch = bd.Sketch() + bd.Polygon(*pts)
        sketch = bd.fillet(sketch.vertices(), radius=4.0)
        return bd.extrude(sketch, amount=THICK)
    return bd.extrude(bd.RectangleRounded(LENGTH, WIDTH, radius=8.0), amount=THICK)


def star(outer: float, inner: float):
    pts = []
    for i in range(10):
        r = outer if i % 2 == 0 else inner
        a = math.radians(90 + i * 36)
        pts.append((r * math.cos(a), r * math.sin(a)))
    sketch = bd.Sketch() + bd.Polygon(*pts)
    return bd.fillet(sketch.vertices(), radius=1.2)


@step(out="model.step")
@glb(out="model.glb")
@stl(out="model.stl")
def model():
    p = params()
    shape = p.get("shape", "rounded")
    body = plate(shape)
    body = soften(body, body.edges().group_by(bd.Axis.Z)[-1], radii=(0.6, 0.4))
    text_room = LENGTH - 30 - (28 if shape == "star" else 0) - (14 if shape == "arrow" else 0)
    text = label_face(p["label"], 12.0, text_room, WIDTH - 12)
    # Letters run along the bookmark, starting after the end that carries the star / arrow.
    x0 = -LENGTH / 2 + 15 + text_room / 2
    letters = bd.Pos(x0, 0, THICK) * bd.extrude(text, amount=RAISE_MM)
    out = body + letters
    if shape == "star":
        out = out + bd.Pos(LENGTH / 2 - 22, 0, THICK) * bd.extrude(star(11.0, 5.0), amount=RAISE_MM)
    return finish(out, p["color"])


if __name__ == "__main__":
    model()
