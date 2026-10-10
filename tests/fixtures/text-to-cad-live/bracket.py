from cadgen import build123d as bd
from cadgen import glb, step, stl

# Flat mounting bracket from the buyer's description (millimetres).
LENGTH = 60.0  # buyer: 60 mm long
WIDTH = 40.0  # buyer: 40 mm wide
THICKNESS = 5.0  # buyer: 5 mm thick
HOLE_D = 5.0  # buyer: two 5 mm holes
HOLE_PITCH = 40.0  # typical: holes 10 mm in from each end
CORNER_R = 4.0  # typical: rounded plan corners
EDGE_R = 0.8  # typical: softened top edges


@step(out="model.step")
@glb(out="model.glb", mesh_tolerance=0.01, mesh_angular_tolerance=0.2)
@stl(out="model.stl", mesh_tolerance=0.01, mesh_angular_tolerance=0.2)
def model():
    plate = bd.extrude(bd.RectangleRounded(LENGTH, WIDTH, CORNER_R), amount=THICKNESS)
    for x in (-HOLE_PITCH / 2, HOLE_PITCH / 2):
        plate = plate - bd.Pos(x, 0, THICKNESS / 2) * bd.Cylinder(HOLE_D / 2, THICKNESS + 2)
    plate = bd.fillet(plate.edges().group_by(bd.Axis.Z)[-1], radius=EDGE_R)
    return plate


if __name__ == "__main__":
    model()
