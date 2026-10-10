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

    params: dict[str, Any]
