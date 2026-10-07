"""CadSpec: the only input the CAD worker accepts.

Mirrors ``src/contracts/cad.ts`` (zod) in the web app. Keep the two in sync: the
contract test ``tests/test_contract.py`` checks the families and bounds listed in
``SPEC_BOUNDS`` against a JSON snapshot that the TypeScript tests also read.

All lengths are millimetres. Every bound exists so a bad or hostile spec fails
validation instead of reaching OpenCascade.
"""

from __future__ import annotations

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


CadSpec = Annotated[Union[SheetPanel, LBracket, Enclosure], Field(discriminator="family")]


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
}
