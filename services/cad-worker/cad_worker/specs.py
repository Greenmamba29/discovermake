"""CadSpec: the only input the CAD worker accepts.

Mirrors ``src/contracts/cad.ts`` (zod) in the web app. Keep the two in sync: the
contract test ``tests/test_contract.py`` checks the families and bounds listed in
``SPEC_BOUNDS`` against a JSON snapshot that the TypeScript tests also read.

All lengths are millimetres. Every bound exists so a bad or hostile spec fails
validation instead of reaching OpenCascade.
"""

from __future__ import annotations

import math
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

Mm = Annotated[float, Field(gt=0, le=3000)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Hole(_Strict):
    """A round through-hole. Coordinates depend on the family (see each family)."""

    x_mm: float = Field(ge=0, le=3000)
    y_mm: float = Field(ge=0, le=3000)
    diameter_mm: float = Field(ge=0.5, le=200)


class SheetPanel(_Strict):
    """Flat laser-cut plate. Hole coordinates are from the lower-left corner of the plate."""

    family: Literal["sheet_panel"]
    width_mm: float = Field(ge=10, le=3000)
    height_mm: float = Field(ge=10, le=1500)
    thickness_mm: float = Field(ge=0.5, le=25)
    corner_radius_mm: float = Field(default=0, ge=0, le=500)
    holes: list[Hole] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _check(self) -> "SheetPanel":
        if self.corner_radius_mm * 2 >= min(self.width_mm, self.height_mm):
            raise ValueError("corner_radius_mm must be less than half the shorter side")
        for i, h in enumerate(self.holes):
            _hole_inside(i, h, self.width_mm, self.height_mm)
        return self


class LBracket(_Strict):
    """90-degree sheet-metal bracket, bent once.

    ``leg_a_mm`` and ``leg_b_mm`` are OUTSIDE dimensions. Holes on a leg use
    ``x_mm`` = position across the width and ``y_mm`` = distance from that leg's
    free edge.
    """

    family: Literal["l_bracket"]
    leg_a_mm: float = Field(ge=10, le=1000)
    leg_b_mm: float = Field(ge=10, le=1000)
    width_mm: float = Field(ge=10, le=1500)
    thickness_mm: float = Field(ge=0.5, le=12)
    inside_bend_radius_mm: float = Field(ge=0.5, le=50)
    k_factor: float = Field(default=0.44, ge=0.25, le=0.5)
    holes_a: list[Hole] = Field(default_factory=list, max_length=50)
    holes_b: list[Hole] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _check(self) -> "LBracket":
        setback = self.inside_bend_radius_mm + self.thickness_mm
        for name, leg, holes in (("holes_a", self.leg_a_mm, self.holes_a), ("holes_b", self.leg_b_mm, self.holes_b)):
            flat = leg - setback
            if flat < 2 * self.thickness_mm:
                raise ValueError(f"{name}: leg is too short for this thickness and bend radius")
            for i, h in enumerate(holes):
                _hole_inside(i, h, self.width_mm, flat, label=name)
        return self


class Standoff(_Strict):
    """Boss on the enclosure floor. x/y are from the inner centre."""

    x_mm: float = Field(ge=-500, le=500)
    y_mm: float = Field(ge=-500, le=500)
    height_mm: float = Field(ge=1, le=100)
    outer_diameter_mm: float = Field(ge=3, le=30)
    hole_diameter_mm: float = Field(ge=1, le=20)


class Enclosure(_Strict):
    """Open box plus optional lip lid (3D print or CNC). ``inner_*`` is the usable cavity."""

    family: Literal["enclosure"]
    inner_x_mm: float = Field(ge=10, le=500)
    inner_y_mm: float = Field(ge=10, le=500)
    inner_z_mm: float = Field(ge=10, le=500)
    wall_mm: float = Field(ge=1, le=10)
    corner_radius_mm: float = Field(default=0, ge=0, le=50)
    lid: bool = True
    vent_slots: int = Field(default=0, ge=0, le=20)
    standoffs: list[Standoff] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def _check(self) -> "Enclosure":
        if self.corner_radius_mm and self.corner_radius_mm >= min(self.inner_x_mm, self.inner_y_mm) / 2 + self.wall_mm:
            raise ValueError("corner_radius_mm is too large for the enclosure footprint")
        for i, s in enumerate(self.standoffs):
            if s.hole_diameter_mm >= s.outer_diameter_mm:
                raise ValueError(f"standoffs[{i}]: hole must be smaller than the boss")
            if s.height_mm >= self.inner_z_mm:
                raise ValueError(f"standoffs[{i}]: taller than the cavity")
            r = s.outer_diameter_mm / 2
            if abs(s.x_mm) + r > self.inner_x_mm / 2 or abs(s.y_mm) + r > self.inner_y_mm / 2:
                raise ValueError(f"standoffs[{i}]: outside the cavity")
        if self.vent_slots:
            # Slots are 3 mm wide on a 6 mm pitch along the X walls.
            if self.vent_slots * 6 > self.inner_y_mm:
                raise ValueError("too many vent_slots for this wall length")
            if self.inner_z_mm < 15:
                raise ValueError("vent_slots need inner_z_mm >= 15")
        return self


# ---------------------------------------------------------------------------
# Stage 1 families: U-channel, multi-bend bracket, slotted plate, sheet enclosure
# ---------------------------------------------------------------------------
#
# Shared sheet-metal conventions (same as ``l_bracket``):
#   * flange lengths are OUTSIDE dimensions (outer face to outer face of the
#     neighbouring flange, i.e. what a caliper reads on the folded part);
#   * every bend is 90 degrees, so the outside setback per bend is r + t and the
#     bend allowance is (pi / 2) * (r + k * t);
#   * the flat length from a bend line to a free edge must be at least
#     ``MIN_FLANGE_RATIO`` x thickness (the R1 quote engine's press-brake rule), and
#     every hole edge keeps at least one thickness from part edges and bend zones.

#: Mirrors the R1 DFM rule ``bend_flange_min`` (minFlangeRatio = 4 in the seeded catalog).
MIN_FLANGE_RATIO = 4.0


def bend_allowance(r: float, t: float, k: float) -> float:
    return (math.pi / 2) * (r + k * t)


class FlangeHole(_Strict):
    """A round hole on one flange of a bent part.

    ``flange`` is the 0-based flange index (in profile order), ``x_mm`` the position
    across the part width (along the bend lines) and ``y_mm`` the distance along the
    flange from that flange's START outer face (for the first flange: its free edge).
    """

    flange: int = Field(ge=0, le=4)
    x_mm: float = Field(ge=0, le=3000)
    y_mm: float = Field(ge=0, le=3000)
    diameter_mm: float = Field(ge=0.5, le=200)


def check_bent_profile(
    flanges: list[float],
    angles: list[int],
    width: float,
    t: float,
    r: float,
    k: float,
    holes: list[FlangeHole],
    label: str = "flanges_mm",
) -> list[float]:
    """Validates a 90-degree bend profile and its holes. Returns the flat segment lengths."""
    if len(flanges) != len(angles) + 1:
        raise ValueError(f"{label}: need exactly one more flange than bends ({len(angles)} bends -> {len(angles) + 1} flanges)")
    setback = r + t
    ba = bend_allowance(r, t, k)
    flats: list[float] = []
    n = len(flanges)
    for i, length in enumerate(flanges):
        bends_here = (1 if i > 0 else 0) + (1 if i < n - 1 else 0)
        flat = length - bends_here * setback
        if flat <= 0:
            raise ValueError(f"{label}[{i}] = {length} mm is shorter than its bend setback ({bends_here} x {setback:.2f} mm)")
        # End flanges: bend line -> free edge. Middle flanges: room between two bend lines.
        need = MIN_FLANGE_RATIO * t
        have = flat + ba / 2 if bends_here == 1 else flat + ba
        if have < need - 1e-9:
            raise ValueError(
                f"{label}[{i}] = {length} mm is too short for a {t} mm sheet with a {r} mm bend radius: "
                f"the flat flange is {have:.2f} mm, the press brake needs at least {need:.2f} mm ({MIN_FLANGE_RATIO:g} x thickness)"
            )
        flats.append(flat)
    for j, h in enumerate(holes):
        if h.flange >= n:
            raise ValueError(f"holes[{j}]: flange {h.flange} does not exist ({n} flanges)")
        start = 0.0 if h.flange == 0 else setback
        lo, hi = start, start + flats[h.flange]
        rad = h.diameter_mm / 2
        # Edge distance >= thickness from both part edges and from the bend zones.
        if h.y_mm - rad < lo + t - 1e-9 or h.y_mm + rad > hi - t + 1e-9:
            raise ValueError(
                f"holes[{j}] at y={h.y_mm} d={h.diameter_mm} must sit on the flat of flange {h.flange} "
                f"(centre between {lo + t + rad:.2f} and {hi - t - rad:.2f} mm) to keep one thickness from bends and edges"
            )
        if h.x_mm - rad < t - 1e-9 or h.x_mm + rad > width - t + 1e-9:
            raise ValueError(f"holes[{j}] at x={h.x_mm} d={h.diameter_mm} must keep {t} mm from the side edges")
    return flats


class UChannel(_Strict):
    """Sheet-metal U-channel: base plus two flanges bent the same way (two 90-degree bends).

    ``flange_a_mm``, ``base_mm`` and ``flange_b_mm`` are OUTSIDE dimensions;
    ``length_mm`` runs along the bend lines. Holes use ``FlangeHole`` with
    flange 0 = flange A, 1 = base, 2 = flange B (y from the flange's start outer face:
    flange A from its free edge, base from flange A's outer face, flange B from the
    base's outer face).
    """

    family: Literal["u_channel"]
    flange_a_mm: float = Field(ge=5, le=1000)
    base_mm: float = Field(ge=5, le=1500)
    flange_b_mm: float = Field(ge=5, le=1000)
    length_mm: float = Field(ge=10, le=1500)
    thickness_mm: float = Field(ge=0.5, le=12)
    inside_bend_radius_mm: float = Field(ge=0.5, le=50)
    k_factor: float = Field(default=0.44, ge=0.25, le=0.5)
    holes: list[FlangeHole] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _check(self) -> "UChannel":
        check_bent_profile(self.flanges(), self.angles(), self.length_mm, self.thickness_mm, self.inside_bend_radius_mm, self.k_factor, self.holes)
        return self

    def flanges(self) -> list[float]:
        return [self.flange_a_mm, self.base_mm, self.flange_b_mm]

    def angles(self) -> list[int]:
        return [90, 90]


class MultiBendBracket(_Strict):
    """Z, hat and other open profiles: 1-4 bends of +90 / -90 degrees.

    ``flanges_mm`` lists the OUTSIDE length of every flange in profile order
    (len = bends + 1); ``bend_angles_deg[i]`` is the bend between flange i and i+1
    (+90 = up, -90 = down, seen from the start of the profile). A Z is
    ``[90, -90]``, a hat ``[90, -90, -90, 90]``.
    """

    family: Literal["multi_bend_bracket"]
    flanges_mm: list[Annotated[float, Field(ge=5, le=1000)]] = Field(min_length=2, max_length=5)
    bend_angles_deg: list[Literal[90, -90]] = Field(min_length=1, max_length=4)
    width_mm: float = Field(ge=10, le=1500)
    thickness_mm: float = Field(ge=0.5, le=12)
    inside_bend_radius_mm: float = Field(ge=0.5, le=50)
    k_factor: float = Field(default=0.44, ge=0.25, le=0.5)
    holes: list[FlangeHole] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _check(self) -> "MultiBendBracket":
        check_bent_profile(list(self.flanges_mm), list(self.bend_angles_deg), self.width_mm, self.thickness_mm, self.inside_bend_radius_mm, self.k_factor, self.holes)
        return self


class Slot(_Strict):
    """An obround slot. ``x_mm``/``y_mm`` is its centre (from the plate's lower-left corner);
    ``length_mm`` is end to end (> width); ``angle_deg`` rotates it counter-clockwise."""

    x_mm: float = Field(ge=0, le=3000)
    y_mm: float = Field(ge=0, le=3000)
    length_mm: float = Field(gt=0, le=1000)
    width_mm: float = Field(ge=0.5, le=200)
    angle_deg: float = Field(default=0, ge=0, lt=180)


class Countersink(_Strict):
    """A countersunk through-hole for a flat-head screw. The cone is modelled in STEP/GLB;
    the DXF cuts the through-diameter (the shop countersinks after cutting)."""

    x_mm: float = Field(ge=0, le=3000)
    y_mm: float = Field(ge=0, le=3000)
    through_diameter_mm: float = Field(ge=1, le=50)
    head_diameter_mm: float = Field(ge=2, le=80)
    angle_deg: Literal[82, 90, 100] = 90

    def depth(self) -> float:
        return (self.head_diameter_mm - self.through_diameter_mm) / 2 / math.tan(math.radians(self.angle_deg / 2))


class SlottedPlate(_Strict):
    """Flat laser-cut plate with round holes, obround slots and countersunk holes.

    Coordinates are from the plate's lower-left corner. Every feature keeps at least one
    thickness of material to the plate edge and to its neighbours; countersinks must leave
    a straight bore (cone depth <= 75% of thickness).
    """

    family: Literal["slotted_plate"]
    width_mm: float = Field(ge=10, le=3000)
    height_mm: float = Field(ge=10, le=1500)
    thickness_mm: float = Field(ge=0.5, le=25)
    corner_radius_mm: float = Field(default=0, ge=0, le=500)
    holes: list[Hole] = Field(default_factory=list, max_length=200)
    slots: list[Slot] = Field(default_factory=list, max_length=100)
    countersinks: list[Countersink] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _check(self) -> "SlottedPlate":
        w, h, t, cr = self.width_mm, self.height_mm, self.thickness_mm, self.corner_radius_mm
        if cr * 2 >= min(w, h):
            raise ValueError("corner_radius_mm must be less than half the shorter side")
        if not (self.holes or self.slots or self.countersinks):
            raise ValueError("a slotted_plate needs at least one hole, slot or countersink (use sheet_panel for a blank)")
        features: list[tuple[str, tuple[float, float], tuple[float, float], float]] = []
        for i, hole in enumerate(self.holes):
            features.append((f"holes[{i}]", (hole.x_mm, hole.y_mm), (hole.x_mm, hole.y_mm), hole.diameter_mm / 2))
        for i, s in enumerate(self.slots):
            if s.length_mm <= s.width_mm:
                raise ValueError(f"slots[{i}]: length_mm must be greater than width_mm (use a hole instead)")
            if s.width_mm < t - 1e-9:
                raise ValueError(f"slots[{i}]: a {s.width_mm} mm slot is narrower than the {t} mm sheet; the laser needs width >= thickness")
            a, b = slot_ends(s)
            features.append((f"slots[{i}]", a, b, s.width_mm / 2))
        for i, c in enumerate(self.countersinks):
            if c.head_diameter_mm <= c.through_diameter_mm:
                raise ValueError(f"countersinks[{i}]: head_diameter_mm must exceed through_diameter_mm")
            if c.depth() > 0.75 * t + 1e-9:
                raise ValueError(f"countersinks[{i}]: the {c.depth():.2f} mm cone is too deep for a {t} mm plate (max 75% of thickness)")
            features.append((f"countersinks[{i}]", (c.x_mm, c.y_mm), (c.x_mm, c.y_mm), c.head_diameter_mm / 2))
        for name, a, b, rad in features:
            for p in (a, b):
                if _inset_rounded_rect(p, w, h, cr) < rad + t - 1e-9:
                    raise ValueError(f"{name} must keep {t} mm (one thickness) from the plate edge")
        for i in range(len(features)):
            for j in range(i + 1, len(features)):
                ni, ai, bi, ri = features[i]
                nj, aj, bj, rj = features[j]
                if _segment_distance(ai, bi, aj, bj) - ri - rj < t - 1e-9:
                    raise ValueError(f"{ni} and {nj} are closer than one thickness ({t} mm)")
        return self


class SheetEnclosure(_Strict):
    """Bent sheet-metal enclosure made from flat patterns the R1 network can cut and bend.

    Panels: a U-channel body (floor + two side walls), two U-shaped end caps riveted
    inside the body ends, and a U-shaped lid whose lips overlap the walls (drip edge).
    ``inner_*`` is the usable cavity: x along the body (between the end caps), y between
    the side walls, z from the floor to the underside of the lid.

    Fastener holes (blind rivets for the end caps, M3 screws for the lid) are placed by
    the worker: they are a construction detail, not a buyer dimension. Buyer features:
    ``floor_holes`` (x from the inner face of the first end cap, y from the inner face of
    side wall A) and an optional ``gland_diameter_mm`` hole centred on the second end cap.
    """

    family: Literal["sheet_enclosure"]
    inner_x_mm: float = Field(ge=60, le=700)
    inner_y_mm: float = Field(ge=40, le=500)
    inner_z_mm: float = Field(ge=30, le=500)
    thickness_mm: float = Field(ge=0.8, le=3.2)
    inside_bend_radius_mm: float = Field(ge=0.5, le=4)
    k_factor: float = Field(default=0.44, ge=0.25, le=0.5)
    end_flange_mm: float = Field(default=15, ge=8, le=40)
    lid_lip_mm: float = Field(default=15, ge=8, le=60)
    floor_holes: list[Hole] = Field(default_factory=list, max_length=20)
    gland_diameter_mm: float | None = Field(default=None, ge=3, le=40)

    @model_validator(mode="after")
    def _check(self) -> "SheetEnclosure":
        t, r = self.thickness_mm, self.inside_bend_radius_mm
        for name, length in (("end_flange_mm", self.end_flange_mm), ("lid_lip_mm", self.lid_lip_mm)):
            check_bent_profile([length, 100, length], [90, 90], 1000, t, r, self.k_factor, [], label=name)
            # The fastener hole (M3 clearance, 3.4 mm) sits mid-flat with one thickness each side.
            if length - (r + t) < 2 * t + 3.4:
                raise ValueError(f"{name} leaves no room for a fastener hole on this sheet and bend radius")
        # The lid screw goes through the lip and the wall: it must also clear the wall's top edge
        # (the lid sits on a gasket gap above the walls).
        lip_y = (self.lid_lip_mm - (r + t)) / 2
        if self.lid_lip_mm - t - lid_gap_mm(r) - lip_y - 1.7 < t - 1e-9:
            raise ValueError("lid_lip_mm is too short to screw the lid to the walls; use a longer lip")
        if self.inner_z_mm < self.lid_lip_mm + 2 * self.end_flange_mm:
            raise ValueError("inner_z_mm is too small for the lid lip and the end-cap rivets")
        body_len = self.inner_x_mm + 2 * t
        if body_len / 4 - 2 < self.end_flange_mm + t:
            raise ValueError("inner_x_mm is too short to keep the lid screws clear of the end caps")
        if self.inner_y_mm - 2 * (r + t) < 4 * t:
            raise ValueError("inner_y_mm is too narrow for this sheet and bend radius")
        for i, hole in enumerate(self.floor_holes):
            rad = hole.diameter_mm / 2
            # The floor is flat from r inside each wall face; keep one thickness from that bend zone.
            if hole.y_mm - rad < r + t - 1e-9 or hole.y_mm + rad > self.inner_y_mm - r - t + 1e-9:
                raise ValueError(f"floor_holes[{i}] must keep {t} mm from the side-wall bends")
            if hole.x_mm - rad < t - 1e-9 or hole.x_mm + rad > self.inner_x_mm - t + 1e-9:
                raise ValueError(f"floor_holes[{i}] must keep {t} mm from the end caps")
        if self.gland_diameter_mm is not None:
            plate_w = self.inner_y_mm - 2 * (r + t)
            if self.gland_diameter_mm + 4 * t > min(plate_w, self.inner_z_mm - r):
                raise ValueError("gland_diameter_mm does not fit the end cap")
        return self


# ---------------------------------------------------------------------------
# R6 Reconstruct: printed replacement parts (FDM / SLS)
# ---------------------------------------------------------------------------
#
# Every product-defining number of these families is a buyer CALIPER reading (or a shaft
# standard the buyer picked); the web app's Reconstruct planner refuses to fill them from a
# photo estimate. Process choices (chamfer, rib depth, fit clearance) have defaults.

#: Geometric floor for printed walls. The print quote engine's DFM blocks below 1.2 mm
#: (``PRINT_MIN_WALL_MM`` in src/server/quote/printing); the worker only refuses what
#: cannot be built at all.
PRINT_WALL_FLOOR_MM = 0.8


class RoundKnob(_Strict):
    """A round control knob, printed bore-down.

    ``diameter_mm`` x ``height_mm`` is the body; a blind bore of ``bore_depth_mm`` comes up
    from the underside for the shaft (``shaft_diameter_mm``, plus ``bore_clearance_mm`` for
    the printed fit). A D-shaft bore keeps a flat ``shaft_flat_depth_mm`` deep (6 mm D-shafts:
    1.5 mm, i.e. 4.5 mm across the flat). Optional vertical grip flutes, a pointer notch on
    the top face and a top-edge chamfer.
    """

    family: Literal["round_knob"]
    diameter_mm: float = Field(ge=8, le=120)
    height_mm: float = Field(ge=5, le=80)
    bore_type: Literal["d_shaft", "round"] = "d_shaft"
    shaft_diameter_mm: float = Field(ge=2, le=25)
    shaft_flat_depth_mm: float | None = Field(default=None, ge=0.2, le=6)
    bore_depth_mm: float = Field(ge=2, le=78)
    bore_clearance_mm: float = Field(default=0.15, ge=0, le=0.5)
    grip_ribs: int = Field(default=0, ge=0, le=60)
    rib_depth_mm: float = Field(default=0.8, ge=0.3, le=3)
    pointer_notch: bool = False
    chamfer_mm: float = Field(default=0.5, ge=0, le=5)

    @model_validator(mode="after")
    def _check(self) -> "RoundKnob":
        if self.bore_type == "d_shaft":
            if self.shaft_flat_depth_mm is None:
                raise ValueError("a d_shaft bore needs shaft_flat_depth_mm")
            if self.shaft_flat_depth_mm >= self.shaft_diameter_mm / 2:
                raise ValueError("shaft_flat_depth_mm must be less than the shaft radius")
        elif self.shaft_flat_depth_mm is not None:
            raise ValueError("shaft_flat_depth_mm is only for a d_shaft bore")
        if self.bore_depth_mm > self.height_mm - PRINT_WALL_FLOOR_MM:
            raise ValueError(f"bore_depth_mm must leave at least {PRINT_WALL_FLOOR_MM} mm of cap above the bore")
        if self.min_wall_mm() < PRINT_WALL_FLOOR_MM - 1e-9:
            raise ValueError(f"the wall around the bore is {self.min_wall_mm():.2f} mm; at least {PRINT_WALL_FLOOR_MM} mm is needed (smaller shaft, fewer or shallower ribs, or a larger knob)")
        if self.chamfer_mm and self.chamfer_mm >= min(self.height_mm / 3, self.diameter_mm / 6):
            raise ValueError("chamfer_mm is too large for this knob")
        if self.grip_ribs:
            pitch = math.pi * self.diameter_mm / self.grip_ribs
            if pitch < 2 * self.rib_depth_mm + 1.0:
                raise ValueError("too many grip_ribs for this diameter (flutes would merge)")
        if self.pointer_notch and self.height_mm - self.bore_depth_mm < POINTER_NOTCH_DEPTH_MM + PRINT_WALL_FLOOR_MM:
            raise ValueError("a pointer notch needs a thicker cap above the bore")
        return self

    def bore_diameter(self) -> float:
        return self.shaft_diameter_mm + self.bore_clearance_mm

    def min_wall_mm(self) -> float:
        radial = (self.diameter_mm - self.bore_diameter()) / 2 - (self.rib_depth_mm if self.grip_ribs else 0)
        cap = self.height_mm - self.bore_depth_mm - (POINTER_NOTCH_DEPTH_MM if self.pointer_notch else 0)
        return round(min(radial, cap), 3)


#: Pointer notch on the knob's top face: a 1.2 mm wide groove this deep, from 25% of the radius to the rim.
POINTER_NOTCH_DEPTH_MM = 0.6
POINTER_NOTCH_WIDTH_MM = 1.2


class SpacerBushing(_Strict):
    """A plain or flanged spacer / bushing (tube), printed flange-down.

    ``length_mm`` is the overall length including the flange.
    """

    family: Literal["spacer_bushing"]
    outer_diameter_mm: float = Field(ge=3, le=200)
    inner_diameter_mm: float = Field(ge=1, le=190)
    length_mm: float = Field(ge=1, le=300)
    flange_diameter_mm: float | None = Field(default=None, ge=4, le=300)
    flange_thickness_mm: float | None = Field(default=None, ge=0.8, le=50)
    chamfer_mm: float = Field(default=0, ge=0, le=3)

    @model_validator(mode="after")
    def _check(self) -> "SpacerBushing":
        if (self.flange_diameter_mm is None) != (self.flange_thickness_mm is None):
            raise ValueError("a flange needs both flange_diameter_mm and flange_thickness_mm")
        if self.flange_diameter_mm is not None:
            if self.flange_diameter_mm <= self.outer_diameter_mm:
                raise ValueError("flange_diameter_mm must be larger than outer_diameter_mm")
            if self.flange_thickness_mm >= self.length_mm:  # type: ignore[operator]
                raise ValueError("flange_thickness_mm must be less than length_mm")
        if self.min_wall_mm() < PRINT_WALL_FLOOR_MM - 1e-9:
            raise ValueError(f"the tube wall is {self.min_wall_mm():.2f} mm; at least {PRINT_WALL_FLOOR_MM} mm is needed")
        if self.chamfer_mm and self.chamfer_mm >= self.min_wall_mm() / 2:
            raise ValueError("chamfer_mm must be less than half the wall")
        return self

    def min_wall_mm(self) -> float:
        walls = [(self.outer_diameter_mm - self.inner_diameter_mm) / 2]
        if self.flange_thickness_mm is not None:
            walls.append(self.flange_thickness_mm)
        return round(min(walls), 3)


def lid_gap_mm(r: float) -> float:
    """Compressed gasket under a sheet-enclosure lid: at least the inside bend radius, so the
    lid's bend never touches the wall tops."""
    return max(2.0, r + 0.2)


def slot_ends(s: Slot) -> tuple[tuple[float, float], tuple[float, float]]:
    """Centres of the two end arcs of a slot."""
    half = (s.length_mm - s.width_mm) / 2
    dx, dy = math.cos(math.radians(s.angle_deg)) * half, math.sin(math.radians(s.angle_deg)) * half
    return (s.x_mm - dx, s.y_mm - dy), (s.x_mm + dx, s.y_mm + dy)


def _inset_rounded_rect(p: tuple[float, float], w: float, h: float, r: float) -> float:
    """Distance from an inside point to the boundary of a w x h rectangle with corner radius r (negative outside)."""
    qx = abs(p[0] - w / 2) - (w / 2 - r)
    qy = abs(p[1] - h / 2) - (h / 2 - r)
    outside = math.hypot(max(qx, 0), max(qy, 0))
    return -(outside + min(max(qx, qy), 0) - r)


def _point_segment(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = dx * dx + dy * dy
    u = 0.0 if den == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den))
    return math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy))


def _segment_distance(a1, b1, a2, b2) -> float:
    """Shortest distance between two 2D segments (0 when they cross)."""

    def side(p, q, s):
        return (s[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (s[0] - p[0])

    if a1 != b1 and a2 != b2:
        d1, d2 = side(a2, b2, a1), side(a2, b2, b1)
        d3, d4 = side(a1, b1, a2), side(a1, b1, b2)
        if (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0):
            return 0.0
    return min(_point_segment(a1, a2, b2), _point_segment(b1, a2, b2), _point_segment(a2, a1, b1), _point_segment(b2, a1, b1))


CadSpec = Annotated[
    Union[SheetPanel, LBracket, Enclosure, UChannel, MultiBendBracket, SlottedPlate, SheetEnclosure, RoundKnob, SpacerBushing],
    Field(discriminator="family"),
]


class GenerateRequest(_Strict):
    spec: CadSpec
    #: Optional caller reference (e.g. ``bld_x@v3``), echoed back for tracing.
    ref: str | None = Field(default=None, max_length=120)


def _hole_inside(i: int, h: Hole, width: float, height: float, label: str = "holes") -> None:
    r = h.diameter_mm / 2
    if h.x_mm - r <= 0 or h.x_mm + r >= width or h.y_mm - r <= 0 or h.y_mm + r >= height:
        raise ValueError(f"{label}[{i}] at ({h.x_mm}, {h.y_mm}) d={h.diameter_mm} is not fully inside the part")


#: Family -> process hints (what the web app should quote/source it as).
FAMILY_PROCESS = {
    "sheet_panel": ["laser cutting"],
    "l_bracket": ["laser cutting", "press brake bending"],
    "enclosure": ["3D printing", "CNC milling"],
    "u_channel": ["laser cutting", "press brake bending"],
    "multi_bend_bracket": ["laser cutting", "press brake bending"],
    "slotted_plate": ["laser cutting", "countersinking"],
    "sheet_enclosure": ["laser cutting", "press brake bending", "hardware insertion"],
    "round_knob": ["3D printing"],
    "spacer_bushing": ["3D printing"],
}

#: Families whose flat patterns the R1 instant quote engine prices directly.
SHEET_FAMILIES = ("sheet_panel", "l_bracket", "u_channel", "multi_bend_bracket", "slotted_plate", "sheet_enclosure")

#: R6 printed families: STL for the print farm, priced by the print quote engine from the manifest.
PRINTED_FAMILIES = ("round_knob", "spacer_bushing")
