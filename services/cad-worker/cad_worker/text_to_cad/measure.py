"""The worker's own geometry check. Runs in the cadgen environment, in the same sandbox as the
model, AFTER the model has exited: it reads the STEP the model wrote and prints one JSON line.
The submitted script never computes these numbers.

    python -I measure.py <model.step>
"""

import json
import sys


def main() -> None:
    import cadgen
    from cadgen import geometry, read_step

    shape = read_step(sys.argv[1])
    solids = list(shape.solids())
    bb = shape.bounding_box()
    try:
        sound = bool(geometry.is_sound(shape))
    except geometry.GeometryError:
        sound = False
    print(
        json.dumps(
            {
                "engine_version": cadgen.__version__,
                "bbox_mm": [max(0.0, float(bb.size.X)), max(0.0, float(bb.size.Y)), max(0.0, float(bb.size.Z))],
                "volume_mm3": max(0.0, float(sum(s.volume for s in solids))),
                "area_mm2": max(0.0, float(shape.area)),
                "solids": len(solids),
                "sound": sound,
            }
        )
    )


if __name__ == "__main__":
    main()
