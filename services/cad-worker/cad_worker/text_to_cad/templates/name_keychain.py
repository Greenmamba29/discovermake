"""Name keychain: a rounded tag with a ring hole and the name raised on top.

small: 20 mm tall, 3 mm thick, 5 mm ring hole; big: 26 mm tall, 4 mm thick, 6 mm ring hole.
The tag grows with the name (fit, then capped at 90 / 110 mm). Every wall >= 2.5 mm.
"""

SIZES = {
    "small": {"height": 20.0, "thick": 3.0, "hole": 5.0, "font": 10.0, "max_len": 90.0},
    "big": {"height": 26.0, "thick": 4.0, "hole": 6.0, "font": 13.0, "max_len": 110.0},
}
RAISE_MM = 1.2


@step(out="model.step")
@glb(out="model.glb")
@stl(out="model.stl")
def model():
    p = params()
    s = SIZES[p.get("size", "small")]
    h, t, hole = s["height"], s["thick"], s["hole"]
    ring = h  # square end that carries the ring hole
    text = label_face(p["label"], s["font"], s["max_len"] - ring - 8, h - 6)
    text_w = text.bounding_box().size.X
    length = max(h * 2.2, ring + text_w + 8)

    tag = bd.extrude(bd.RectangleRounded(length, h, radius=h * 0.45), amount=t)
    hole_x = -length / 2 + ring / 2
    tag = tag - bd.Pos(hole_x, 0, -1) * bd.Cylinder(hole / 2, t + 2, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    tag = soften(tag, tag.edges().group_by(bd.Axis.Z)[-1], radii=(0.8, 0.5, 0.3))
    # Centred on the part of the tag after the ring end (from -length/2 + ring to +length/2).
    letters = bd.Pos(ring / 2, 0, t) * bd.extrude(text, amount=RAISE_MM)
    return finish(tag + letters, p["color"])


if __name__ == "__main__":
    model()
