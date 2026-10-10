"""Kids & Family project templates: our own parametric build123d models.

Mirrors KID_TEMPLATE_IDS / KidTemplateParams in src/contracts/text-to-cad.ts. A template is run
as kidlib.py + <template>.py (one model.py), with the validated params written to params.json
and the bundled label font (DejaVu Sans Bold, letters and digits only) next to it. Nothing a kid
chooses is ever written into the code.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

HERE = Path(__file__).resolve().parent
FONT_FILE = HERE / "DejaVuSans-Bold-kids.ttf"
OUTPUTS = {"step": "model.step", "glb": "model.glb", "stl": "model.stl"}

KidLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12, pattern=r"^[A-Za-z0-9 ]+$")]
KidColor = Literal["red", "orange", "yellow", "green", "blue", "purple", "black", "white"]


class _Params(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class NameKeychain(_Params):
    label: KidLabel
    color: KidColor
    size: Literal["small", "big"] = "small"


class PhoneStand(_Params):
    color: KidColor
    angle: Literal["low", "medium", "tall"] = "medium"
    label: KidLabel | None = None


class Bookmark(_Params):
    label: KidLabel
    color: KidColor
    shape: Literal["rounded", "arrow", "star"] = "rounded"


class DeskTidy(_Params):
    color: KidColor
    cups: int = Field(default=3, ge=2, le=4, strict=True)
    label: KidLabel | None = None


class BikeHook(_Params):
    color: KidColor
    label: KidLabel | None = None


TEMPLATES: dict[str, type[_Params]] = {
    "name_keychain": NameKeychain,
    "phone_stand": PhoneStand,
    "bookmark": Bookmark,
    "desk_tidy": DeskTidy,
    "bike_hook": BikeHook,
}


def template_files(template: str, params: _Params) -> dict[str, bytes]:
    """The job folder for one template build: model.py, params.json, label-font.ttf."""
    if template not in TEMPLATES:
        raise KeyError(template)
    source = (HERE / "kidlib.py").read_text("utf-8") + "\n" + (HERE / f"{template}.py").read_text("utf-8")
    return {
        "model.py": source.encode("utf-8"),
        "params.json": json.dumps(params.model_dump(mode="json", exclude_none=True)).encode("utf-8"),
        "label-font.ttf": FONT_FILE.read_bytes(),
    }
