"""Sandboxed SolidCraft builds: a gated command script -> STEP / GLB / STL, measured independently.

SolidCraft (tangency-labs/solidcraft, MIT OR Apache-2.0; kernel solidcore, Apache-2.0) is one
static binary, `solidcraft-cli`, pinned in the Dockerfile with its release checksum:

    SOLIDCRAFT_CLI        path to solidcraft-cli (unset or missing -> every build answers UNAVAILABLE)
    SOLIDCRAFT_TIMEOUT_S  wall-clock limit per build (default 90)

One job, the same layers as the cadgen runner (../text_to_cad/runner.py):

  1. a fresh temp root: the CLI runs with cwd = <root>/job and HOME inside <root>/home;
  2. an `env -i`-style environment: a minimal PATH plus SOLIDCRAFT_NO_TELEMETRY=1, DO_NOT_TRACK=1
     and SOLIDCRAFT_UPDATE_CHECK=0 (the apps send usage statistics and check for updates otherwise);
  3. resource limits (CPU, 3 GB address space, 64 MB files, open files), its own session, and a
     timeout that kills the process group;
  4. `unshare --net --map-root-user` when the kernel allows it (an empty network namespace);
  5. the gate (gate.py) before anything runs, and `--param-check strict`, so a misspelt key is an
     error the model writer can repair instead of being ignored.

Two entry points:

- build_commands(script): Make AI's script (gated) -> files plus the saved design (`model.sc`);
- rebuild_design(design, parameters): the buyer's new sizes applied to that saved design with
  `--param NAME=EXPR`. The design keeps every edge and face pick tied to its geometry, so a fillet
  picked on a 60 mm block still finds its edge at 80 mm; replaying the script would not (its picks
  are plain points). The design must be one this worker wrote: the app sends it back with the
  sha256 the worker reported, and the worker checks it.

Then a SECOND, separate run of the CLI imports the STEP it wrote (`solidcraft-cli eval model.step`)
and reports the geometry: the script never measures itself. The engine's own messages
(`step 3 (solid.fillet): ...`) are already plain and path-free; they go back for the repair loop.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import signal
import tempfile
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..text_to_cad.runner import MAX_OUTPUT_BYTES, Limits, _artifact, _run, failure
from .gate import PARAM_EXPRESSION, PARAM_NAME, check

log = logging.getLogger("cad_worker.solidcraft")

ENGINE_NAME = "solidcraft"
#: The release the Dockerfile pins; the binary reports its own version at runtime.
PINNED_ENGINE_VERSION = "0.48.1"
DEFAULT_TIMEOUT_S = 90.0
MEASURE_TIMEOUT_S = 60.0
SAFE_PATH = "/usr/local/bin:/usr/bin:/bin"
OUTPUT_KINDS = ("step", "glb", "stl")
DESIGN_FILE = "model.sc"
#: A saved design is a zip container: the timeline, parameters and a model cache.
MAX_DESIGN_BYTES = 20 * 1024 * 1024
MAX_OVERRIDES = 64
#: The engine's parameter rows that a person set (not the ones features make for their inputs).
USER_SOURCE = "user"


def solidcraft_cli() -> str | None:
    path = os.environ.get("SOLIDCRAFT_CLI", "").strip()
    return path if path and os.path.isfile(path) and os.access(path, os.X_OK) else None


@lru_cache(maxsize=4)
def engine_version(cli: str) -> str:
    try:
        import subprocess

        out = subprocess.run([cli, "--version"], capture_output=True, timeout=20, env={"PATH": SAFE_PATH, "HOME": tempfile.gettempdir(), "SOLIDCRAFT_NO_TELEMETRY": "1", "DO_NOT_TRACK": "1", "SOLIDCRAFT_UPDATE_CHECK": "0"})
        text = out.stdout.decode("utf-8", "replace").strip().split()
        return text[-1] if text and text[-1][:1].isdigit() else PINNED_ENGINE_VERSION
    except Exception:  # pragma: no cover - reported as the pinned version
        return PINNED_ENGINE_VERSION


def default_limits() -> Limits:
    try:
        timeout = float(os.environ.get("SOLIDCRAFT_TIMEOUT_S", DEFAULT_TIMEOUT_S))
    except ValueError:
        timeout = DEFAULT_TIMEOUT_S
    return Limits(timeout_s=max(5.0, min(timeout, 600.0)))


def sandbox_env(home: Path) -> dict[str, str]:
    """The ONLY environment a build sees (nothing inherited from the worker)."""
    return {
        "PATH": SAFE_PATH,
        "HOME": str(home),
        "TMPDIR": str(home / "tmp"),
        "XDG_DATA_HOME": str(home / "data"),
        "XDG_CONFIG_HOME": str(home / "config"),
        "XDG_CACHE_HOME": str(home / "cache"),
        "SOLIDCRAFT_NO_TELEMETRY": "1",
        "DO_NOT_TRACK": "1",
        "SOLIDCRAFT_UPDATE_CHECK": "0",
        "LANG": "C.UTF-8",
    }


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _engine_error(results: Any, stderr: str) -> str:
    """`Step 3 (solid.fillet): ...` from the CLI's --json-out, else its last stderr line."""
    err = results.get("error") if isinstance(results, dict) else None
    if isinstance(err, dict) and err.get("error"):
        return f"Step {err.get('step', '?')} ({str(err.get('command', '?'))[:60]}): {str(err['error'])[:320]}"
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    # `error: 1 timeline feature(s) failed ...` is followed by one indented line per feature.
    for i, ln in enumerate(lines):
        if "timeline feature(s) failed" in ln and i + 1 < len(lines):
            return "; ".join(lines[i + 1 : i + 4])[:400]
    last = lines[-1] if lines else "the engine stopped without a message"
    return (last[7:] if last.startswith("error: ") else last)[:400]


def _parameters(results: Any) -> list[dict[str, Any]]:
    """The user parameters from the parameters.list step the runner appends."""
    rows = results[-1].get("parameters") if isinstance(results, list) and results and isinstance(results[-1], dict) else None
    out = []
    for p in rows or []:
        if isinstance(p, dict) and p.get("source") == USER_SOURCE and isinstance(p.get("name"), str):
            value = p.get("value")
            out.append(
                {
                    "name": p["name"],
                    "expression": str(p.get("expression", ""))[:80],
                    "value": float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None,
                    "unit": str(p.get("unit") or ""),
                    "comment": str(p.get("comment") or "")[:200],
                }
            )
    return out[:64]


def _geometry(measured: Any) -> dict[str, Any] | None:
    bodies = measured.get("bodies") if isinstance(measured, dict) else None
    if not isinstance(bodies, list):
        return None
    if not bodies:
        return {"bbox_mm": [0.0, 0.0, 0.0], "volume_mm3": 0.0, "area_mm2": 0.0, "solids": 0, "sound": False}
    lo = [min(float(b["bbox"]["min"][i]) for b in bodies) for i in range(3)]
    hi = [max(float(b["bbox"]["max"][i]) for b in bodies) for i in range(3)]
    return {
        "bbox_mm": [round(hi[i] - lo[i], 4) for i in range(3)],
        "volume_mm3": round(sum(float(b.get("volume_mm3") or 0.0) for b in bodies), 3),
        "area_mm2": round(sum(float(b.get("area_mm2") or 0.0) for b in bodies), 3),
        "solids": len(bodies),
        "sound": all(b.get("closed") is True for b in bodies),
    }


def run_job(*, commands: list[dict[str, Any]] | None = None, design: bytes | None = None, overrides: dict[str, str] | None = None, outputs: list[str], limits: Limits | None = None) -> dict[str, Any]:
    """Run an already-gated script, or a saved design with new parameter values, in a fresh sandbox;
    then measure its STEP in a second run. Exactly one of `commands` / `design`."""
    cli = solidcraft_cli()
    if cli is None:
        return failure("UNAVAILABLE", "The SolidCraft engine is not installed on this CAD worker yet.")
    limits = limits or default_limits()
    wanted = [k for k in OUTPUT_KINDS if k in set(outputs)]
    root = Path(tempfile.mkdtemp(prefix="scj-"))
    try:
        job, home = root / "job", root / "home"
        for d in (job, home, home / "tmp", home / "data", home / "config", home / "cache"):
            d.mkdir(parents=True, exist_ok=True)
        # Our parameters.list step at the end reports the model's named sizes after the build.
        listing = {"command": "parameters.list", "params": {}}
        argv = [cli, "run", "model.json"]
        if design is not None:
            (job / "in.sc").write_bytes(design)
            (job / "model.json").write_text(json.dumps({"commands": [listing]}), "utf-8")
            argv += ["--in", "in.sc"]
            for name, expr in (overrides or {}).items():
                argv += ["--param", f"{name}={expr.strip()}"]
        else:
            (job / "model.json").write_text(json.dumps({"commands": [*(commands or []), listing]}), "utf-8")
        argv += ["--results", "--json-out", "results.json", "--param-check", "strict", "--quality", "standard", "--save", DESIGN_FILE]
        for kind in {"step", *wanted}:
            argv += ["--out", f"model.{kind}"]
        env = sandbox_env(home)
        started = time.monotonic()

        built = _run(argv, cwd=job, env=env, limits=limits, timeout_s=limits.timeout_s, logs=root / "logs-build")
        if built.timed_out or (built.returncode in (-signal.SIGXCPU, -signal.SIGKILL) and built.elapsed_s >= limits.timeout_s - 1):
            return failure("TIMEOUT", f"Building the model took longer than {int(limits.timeout_s)} seconds. Try a simpler shape.")
        if built.returncode == -signal.SIGXCPU:
            return failure("TIMEOUT", "Building the model used too much computing time. Try a simpler shape.")
        if built.returncode == -signal.SIGXFSZ:
            return failure("TOO_LARGE", "The model's files grew past the size limit. Try fewer details.")
        results = _read_json(job / "results.json")
        if built.returncode != 0:
            if built.returncode == -signal.SIGKILL:
                return failure("BUILD_FAILED", "The model ran out of memory while building. Try a simpler shape.")
            msg = _engine_error(results, built.stderr)
            if "nothing to export" in msg or "no bodies" in msg:
                return failure("BUILD_FAILED", "The model made no solid: end with a closed 3D body, not only sketches.")
            return failure("BUILD_FAILED", msg)

        paths: dict[str, Path] = {}
        for kind in {"step", *wanted}:
            p = job / f"model.{kind}"
            if not p.is_file() or p.stat().st_size == 0:
                return failure("BUILD_FAILED", f"The model finished but wrote no {kind.upper()} file.")
            if p.stat().st_size > MAX_OUTPUT_BYTES:
                return failure("TOO_LARGE", f"The {kind.upper()} file is over {MAX_OUTPUT_BYTES // (1024 * 1024)} MB. Try fewer details.")
            paths[kind] = p
        saved = job / DESIGN_FILE
        if not saved.is_file() or saved.stat().st_size == 0 or saved.stat().st_size > MAX_DESIGN_BYTES:
            return failure("TOO_LARGE" if saved.is_file() and saved.stat().st_size > MAX_DESIGN_BYTES else "BUILD_FAILED", "The model's design file could not be saved.")

        measured = _run([cli, "eval", "model.step", "--json-out", "measure.json", "--quiet"], cwd=job, env=env, limits=limits, timeout_s=MEASURE_TIMEOUT_S, logs=root / "logs-measure")
        if measured.timed_out:
            return failure("TIMEOUT", "Checking the finished model took too long. Try a simpler shape.")
        geometry = _geometry(_read_json(job / "measure.json")) if measured.returncode == 0 else None
        if geometry is None:
            log.warning("solidcraft: measure failed rc=%s", measured.returncode)
            return failure("BUILD_FAILED", "The model's STEP file could not be read back as a solid.")
        if geometry["solids"] == 0 or geometry["volume_mm3"] <= 0:
            return failure("BUILD_FAILED", "The model made no solid: end with a closed 3D body, not only sketches or surfaces.")
        warnings: list[str] = []
        if geometry["solids"] > 1:
            warnings.append(f"The model is {geometry['solids']} separate solids; they print as separate pieces.")
        if not geometry["sound"]:
            warnings.append("A body is not closed (it is a surface or has a gap). Check it before ordering.")
        parameters = _parameters(results)
        if not parameters:
            warnings.append("The model has no named sizes, so they cannot be changed without describing it again.")

        design_artifact = _artifact("design", saved)
        return {
            "ok": True,
            "engine": {"name": ENGINE_NAME, "version": engine_version(cli)},
            "artifacts": [_artifact(kind, paths[kind]) for kind in wanted],
            "geometry": geometry,
            "parameters": parameters,
            "design": {k: design_artifact[k] for k in ("filename", "content_base64", "sha256", "bytes")},
            "warnings": warnings,
            "build_ms": int((time.monotonic() - started) * 1000),
        }
    finally:
        shutil.rmtree(root, ignore_errors=True)


def build_commands(script: Any, outputs: list[str], *, limits: Limits | None = None) -> dict[str, Any]:
    """Gate, then build Make AI's script. Nothing runs unless the gate passes."""
    gated = check(script)
    if not gated.ok:
        return failure("GATE_REJECTED", "The model uses something that is not allowed, so it was not run.", gated.violations)
    result = run_job(commands=gated.commands, outputs=outputs, limits=limits)
    if result.get("ok"):
        # The exact script that produced these files, so the app keeps what made the design.
        result["script"] = {"commands": gated.commands}
    return result


class DesignError(ValueError):
    pass


def check_overrides(overrides: dict[str, str]) -> None:
    if not overrides:
        raise DesignError("Change at least one size.")
    if len(overrides) > MAX_OVERRIDES:
        raise DesignError(f"At most {MAX_OVERRIDES} sizes can change at once.")
    for name, expr in overrides.items():
        if not PARAM_NAME.match(name):
            raise DesignError(f"`{name[:40]}` is not a parameter name.")
        if not isinstance(expr, str) or not PARAM_EXPRESSION.match(expr.strip()):
            raise DesignError(f"The new value for `{name}` must be a number with a unit or a simple expression.")


def rebuild_design(design: bytes, expected_sha256: str, overrides: dict[str, str], outputs: list[str], *, limits: Limits | None = None) -> dict[str, Any]:
    """New sizes for a design this worker saved: checksum, size and parameter checks, then build."""
    if len(design) == 0 or len(design) > MAX_DESIGN_BYTES:
        return failure("TOO_LARGE" if design else "GATE_REJECTED", "The saved design is empty or too large.")
    if hashlib.sha256(design).hexdigest() != expected_sha256:
        return failure("GATE_REJECTED", "The saved design does not match its checksum, so it was not opened.", [(0, "design sha256 mismatch")])
    if design[:4] != b"PK\x03\x04":
        return failure("GATE_REJECTED", "That is not a saved SolidCraft design.", [(0, "not a design container")])
    try:
        check_overrides(overrides)
    except DesignError as e:
        return failure("GATE_REJECTED", str(e), [(0, str(e))])
    return run_job(design=design, overrides=overrides, outputs=outputs, limits=limits)
