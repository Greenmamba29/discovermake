"""Bike hook: a wall plate (40 x 70 x 5 mm) with two countersunk screw holes and a J-shaped arm
(20 x 10 mm section, 55 mm out, 22 mm upturned tip). Every edge is rounded; the optional name is
engraved 0.6 mm into the side of the arm. Prints with the plate flat on the bed (no supports).
"""

PLATE_W, PLATE_H, PLATE_T = 40.0, 70.0, 5.0
ARM_W, ARM_T, ARM_OUT, TIP = 20.0, 10.0, 55.0, 22.0
SCREW_D, HEAD_D = 4.5, 9.0


@step(out="model.step")
@glb(out="model.glb")
@stl(out="model.stl")
def model():
    p = params()
    plate = bd.extrude(bd.RectangleRounded(PLATE_W, PLATE_H, radius=6.0), amount=PLATE_T)
    arm_y = -PLATE_H / 2 + 8 + ARM_T / 2
    arm = bd.Pos(0, arm_y, PLATE_T - 1) * bd.Box(ARM_W, ARM_T, ARM_OUT + 1, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    tip = bd.Pos(0, arm_y - ARM_T / 2, PLATE_T + ARM_OUT - ARM_T) * bd.Box(ARM_W, TIP, ARM_T, align=(bd.Align.CENTER, bd.Align.MIN, bd.Align.MIN))
    body = plate + arm + tip
    for y in (PLATE_H / 2 - 12, 2.0):
        body = body - bd.Pos(0, y, -1) * bd.Cylinder(SCREW_D / 2, PLATE_T + 2, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        sink = (HEAD_D - SCREW_D) / 2
        body = body - bd.Pos(0, y, PLATE_T - sink) * bd.Cone(SCREW_D / 2, HEAD_D / 2, sink + 0.01, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    body = soften(body, body.edges(), radii=(1.5, 1.0, 0.6))
    if p.get("label"):
        # The arm's side face is the plane x = +ARM_W/2; the label reads along the arm (+Z).
        text = label_face(p["label"], 7.0, ARM_OUT - 14, ARM_T - 3)
        cutter = bd.extrude(text, amount=0.6)
        # +90 about Y: reading direction -> -Z (left to right for someone facing this side),
        # extrusion -> +X, so the cut ends exactly on the face.
        cutter = bd.Location((ARM_W / 2 - 0.6, arm_y, PLATE_T + (ARM_OUT - ARM_T) / 2), (0, 90, 0)) * cutter
        body = body - cutter
    return finish(body, p["color"])


if __name__ == "__main__":
    model()
