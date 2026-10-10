from cadgen import build123d as bd
from cadgen import glb, step, stl

LENGTH = 60.0
DEPTH = 24.0
HEIGHT = 18.0
SLOT_W = 6.0
SLOT_DEPTH = 11.0


@step(out="model.step")
@glb(out="model.glb", mesh_tolerance=0.004, mesh_angular_tolerance=0.4)
@stl(out="model.stl", mesh_tolerance=0.004, mesh_angular_tolerance=0.4)
def model():
    body = bd.Box(LENGTH, DEPTH, HEIGHT, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    body = bd.fillet(body.edges().filter_by(bd.Axis.Z), radius=5)
    for x in (-18.0, 0.0, 18.0):
        slot = bd.Pos(x, 0, HEIGHT - SLOT_DEPTH) * bd.Box(SLOT_W, DEPTH + 2, SLOT_DEPTH + 1, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        rounded = bd.Pos(x, 0, HEIGHT - SLOT_DEPTH) * bd.Rot(90, 0, 0) * bd.Cylinder(SLOT_W / 2, DEPTH + 2)
        body = body - slot - rounded
    body = bd.fillet(body.edges().group_by(bd.Axis.Z)[-1], radius=1)
    return body


if __name__ == "__main__":
    model()
