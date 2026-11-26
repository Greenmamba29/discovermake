"""Request bodies for the text-to-CAD routes (mirrors src/contracts/text-to-cad.ts)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .gate import MAX_SCRIPT_BYTES

Output = Literal["step", "glb", "stl"]


class TextToCadBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    script: str = Field(min_length=1, max_length=MAX_SCRIPT_BYTES)
    outputs: list[Output] = Field(default_factory=lambda: ["step", "glb", "stl"], min_length=1, max_length=3)


class KidTemplateBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Must equal the {template} path segment.
    template: str
    params: dict[str, Any]


class SolidcraftBuildRequest(BaseModel):
    """POST /v1/solidcraft/build: a SolidCraft command script (data, never code), gated before it runs."""

    model_config = ConfigDict(extra="forbid")

    script: dict[str, Any]
    outputs: list[Output] = Field(default_factory=lambda: ["step", "glb", "stl"], min_length=1, max_length=3)


class SolidcraftDesign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_base64: str = Field(min_length=4)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SolidcraftRebuildRequest(BaseModel):
    """POST /v1/solidcraft/rebuild: new sizes for a design this worker saved (checked by its sha256)."""

    model_config = ConfigDict(extra="forbid")

    design: SolidcraftDesign
    parameters: dict[str, str] = Field(min_length=1, max_length=64)
    outputs: list[Output] = Field(default_factory=lambda: ["step", "glb", "stl"], min_length=1, max_length=3)
