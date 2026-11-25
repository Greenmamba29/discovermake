"""Static gate for SolidCraft model scripts (runs before anything executes).

A SolidCraft model is DATA, not code: a JSON list of engine commands, the same ones its app, CLI
and MCP server run (`{"commands": [{"command": "solid.extrude", "params": {...}}, ...]}`). Nothing
in it is executed as a program, so the gate does not have to reason about a language. It still
treats the script as untrusted, because some engine commands read or write files:

- every command id must be in ALLOWED_COMMANDS (modelling only; see commands.py);
- no parameter, at any depth, may name a file, folder, URL, plugin or output (`file`, `url`, ...);
- `path` is allowed only as a list of curve or occurrence ids (`["l1", "a2"]`, `[3, 7]`), never a string;
- `font` is allowed only as a plain family name;
- no string may look like a filesystem path or URL (leading `/` or `~`, `\\`, `../`, `://`, NUL);
- bounded size: commands, nesting depth, string length, total bytes; numbers must be finite.

New sizes are not applied to the script: replaying it would re-resolve every edge and face pick
from plain points. They are applied to the design the first build saved (runner.rebuild_design),
where each pick already follows its geometry. PARAM_NAME / PARAM_EXPRESSION bound those values.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

from .commands import ALLOWED_COMMANDS

MAX_COMMANDS = 400
MAX_DEPTH = 10
MAX_STRING = 2000
MAX_SCRIPT_BYTES = 192 * 1024

#: Parameter keys that would point the engine at something outside the job.
FORBIDDEN_KEYS = frozenset(
    {
        "file",
        "files",
        "filename",
        "url",
        "uri",
        "href",
        "reference",
        "folder",
        "dir",
        "directory",
        "font_file",
        "font_path",
        "plugin",
        "plugin_id",
        "approval",
        "out",
        "output",
        "save",
        "image",
        "texture",
        "hdr",
    }
)
_ID = re.compile(r"^[A-Za-z0-9_#:-]{1,64}$")
_FONT = re.compile(r"^[A-Za-z0-9 ]{1,48}$")
PARAM_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
#: A length or angle expression: numbers, names, units, arithmetic. No quotes, so no text injection.
PARAM_EXPRESSION = re.compile(r"^(?!.*--)[A-Za-z0-9_ .+\-*/()^,]{1,80}$")
PARAM_COMMANDS = ("parameters.change", "parameters.add")


@dataclass
class GateResult:
    ok: bool
    commands: list[dict[str, Any]] = field(default_factory=list)
    #: (step number, rule); step 0 is the script as a whole.
    violations: list[tuple[int, str]] = field(default_factory=list)


def _looks_like_path(s: str) -> bool:
    return s.startswith(("/", "~")) or "\\" in s or "../" in s or "://" in s or "\x00" in s


def _check_value(value: Any, *, key: str | None, depth: int, step: int, out: list[tuple[int, str]]) -> None:
    if depth > MAX_DEPTH:
        out.append((step, "parameters are nested too deeply"))
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                out.append((step, "a parameter name is not text"))
                continue
            lk = k.lower()
            if lk in FORBIDDEN_KEYS:
                out.append((step, f"`{k}` is not allowed: models cannot read or write files"))
                continue
            if lk == "path":
                ok = isinstance(v, list) and all((isinstance(x, int) and not isinstance(x, bool)) or (isinstance(x, str) and _ID.match(x)) for x in v)
                if not ok:
                    out.append((step, "`path` must be a list of curve or occurrence ids, never a file path"))
                continue
            if lk == "font":
                if not (isinstance(v, str) and _FONT.match(v)):
                    out.append((step, "`font` must be a font family name"))
                continue
            _check_value(v, key=k, depth=depth + 1, step=step, out=out)
    elif isinstance(value, list):
        for v in value:
            _check_value(v, key=key, depth=depth + 1, step=step, out=out)
    elif isinstance(value, str):
        if len(value) > MAX_STRING:
            out.append((step, f"a text value is longer than {MAX_STRING} characters"))
        elif _looks_like_path(value):
            out.append((step, f"`{key or 'value'}` looks like a file path or URL"))
    elif isinstance(value, bool) or value is None:
        return
    elif isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            out.append((step, "numbers must be finite"))
    else:
        out.append((step, "unsupported value type"))


def check(script: Any) -> GateResult:
    """Validate a parsed script ({commands: [...]}, or a bare list). Never executes anything."""
    commands = script.get("commands") if isinstance(script, dict) else script
    if isinstance(script, dict) and set(script) - {"commands"}:
        return GateResult(False, violations=[(0, "the script may only hold `commands`")])
    if not isinstance(commands, list) or not commands:
        return GateResult(False, violations=[(0, "the script needs a non-empty `commands` list")])
    if len(commands) > MAX_COMMANDS:
        return GateResult(False, violations=[(0, f"the script has more than {MAX_COMMANDS} commands")])
    try:
        size = len(json.dumps(commands, allow_nan=False).encode("utf-8"))
    except (TypeError, ValueError):
        return GateResult(False, violations=[(0, "the script is not plain JSON (numbers must be finite)")])
    if size > MAX_SCRIPT_BYTES:
        return GateResult(False, violations=[(0, f"the script is larger than {MAX_SCRIPT_BYTES // 1024} KB")])

    violations: list[tuple[int, str]] = []
    clean: list[dict[str, Any]] = []
    for i, step in enumerate(commands, start=1):
        if not isinstance(step, dict) or set(step) - {"command", "params"} or not isinstance(step.get("command"), str):
            violations.append((i, "each step is {command, params}"))
            continue
        cmd = step["command"]
        params = step.get("params", {})
        if params is None:
            params = {}
        if cmd not in ALLOWED_COMMANDS:
            violations.append((i, f"`{cmd[:60]}` is not a modelling command this service runs"))
            continue
        if not isinstance(params, dict):
            violations.append((i, "`params` must be an object"))
            continue
        _check_value(params, key=None, depth=0, step=i, out=violations)
        clean.append({"command": cmd, "params": params})
    if violations:
        return GateResult(False, violations=violations[:50])
    return GateResult(True, commands=clean)


def declared_parameters(commands: list[dict[str, Any]]) -> list[str]:
    """Names the script sets with parameters.change / parameters.add, in order."""
    seen: list[str] = []
    for step in commands:
        if step["command"] in PARAM_COMMANDS:
            name = step["params"].get("name")
            if isinstance(name, str) and name not in seen:
                seen.append(name)
    return seen
