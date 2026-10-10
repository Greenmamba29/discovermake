"""Sandboxed cadgen builds: gated Make AI scripts and our own kid templates.

cadgen (MIT, earthtojake/text-to-cad) cannot share this worker's environment: it installs
cadquery-ocp-novtk, which replaces the cadquery-ocp wheel CadQuery needs. It lives in its own
virtualenv (Docker: /opt/cadgen) and runs only as a subprocess, one job at a time per process:

    CADGEN_PYTHON   the cadgen venv's python (unset -> every build answers UNAVAILABLE)
    CADGEN_NODE     node >= 20 for cadgen's mesh exports (GLB / STL)
    CADGEN_TIMEOUT_S  wall-clock limit per model run (default 120)

Sandbox layers for one job (production adds a no-network container / gVisor around the worker;
see docs/architecture/text-to-cad.md):

  1. a fresh temp root per job: the model runs with cwd = <root>/job; HOME, CADGEN_CACHE_DIR and
     CADGEN_STATE_DIR point inside <root>/home, so no cache, store or daemon is shared between jobs;
  2. `env -i`-style environment: a minimal PATH and only the cadgen switches below
     (CADGEN_DAEMON=0, CADGEN_TELEMETRY=0, DO_NOT_TRACK=1, CADGEN_UPDATE_CHECK=0);
  3. `python -I` (no user site, no PYTHON* variables, script dir not on sys.path);
  4. resource limits set in the child before exec: CPU seconds, address space, file size,
     open files; its own session so a timeout kills the whole process group (node included);
  5. `unshare --net --map-root-user` when the kernel allows it: an empty network namespace.
     Without it a warning is logged once and the container's network policy must provide it.

Then OUR measure script (measure.py) reads the STEP the model wrote, in the same sandbox, and
reports the geometry. Outputs are capped (20 MB each). Every failure maps to a contract code
with a plain-language message: never a stack trace or a server path.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import resource
import shutil
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .gate import OUTPUT_KINDS, check

log = logging.getLogger("cad_worker.text_to_cad")

HERE = Path(__file__).resolve().parent
MEASURE_SCRIPT = HERE / "measure.py"
ENGINE_NAME = "cadgen"
#: The version the Dockerfile pins; the measure script reports the installed one.
PINNED_ENGINE_VERSION = "0.7.20"

MAX_OUTPUT_BYTES = 20 * 1024 * 1024
MAX_LOG_BYTES = 256 * 1024
DEFAULT_TIMEOUT_S = 120.0
MEASURE_TIMEOUT_S = 90.0
SAFE_PATH = "/usr/local/bin:/usr/bin:/bin"


@dataclass(frozen=True)
class Limits:
    timeout_s: float = DEFAULT_TIMEOUT_S
    #: Virtual memory (verified with node 22 doing the mesh export). The container's memory limit
    #: stays the real cap on resident memory.
    address_space_bytes: int = 3 * 1024**3
    file_size_bytes: int = 64 * 1024 * 1024
    open_files: int = 512

    @property
    def cpu_seconds(self) -> int:
        return int(self.timeout_s) + 10


class BuildError(Exception):
    def __init__(self, code: str, message: str, violations: list[tuple[int, str]] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.violations = violations or []


def cadgen_python() -> str | None:
    path = os.environ.get("CADGEN_PYTHON", "").strip()
    return path if path and os.path.isfile(path) and os.access(path, os.X_OK) else None


def cadgen_node() -> str | None:
    path = os.environ.get("CADGEN_NODE", "").strip()
    if path:
        return path if os.path.isfile(path) else None
    return shutil.which("node")


def default_limits() -> Limits:
    try:
        timeout = float(os.environ.get("CADGEN_TIMEOUT_S", DEFAULT_TIMEOUT_S))
    except ValueError:
        timeout = DEFAULT_TIMEOUT_S
    return Limits(timeout_s=max(5.0, min(timeout, 600.0)))


def sandbox_env(home: Path) -> dict[str, str]:
    """The ONLY environment a build sees (nothing inherited from the worker)."""
    env = {
        "PATH": SAFE_PATH,
        "HOME": str(home),
        "TMPDIR": str(home / "tmp"),
        "CADGEN_CACHE_DIR": str(home / "cache"),
        "CADGEN_STATE_DIR": str(home / "state"),
        "XDG_CACHE_HOME": str(home / "cache"),
        "CADGEN_DAEMON": "0",
        "CADGEN_TELEMETRY": "0",
        "DO_NOT_TRACK": "1",
        "CADGEN_UPDATE_CHECK": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
        "LANG": "C.UTF-8",
    }
    node = cadgen_node()
    if node:
        env["CADGEN_NODE"] = node
    return env


_unshare_state: dict[str, bool | None] = {"ok": None, "warned": False}


def network_isolation_prefix() -> list[str]:
    """`unshare --net --map-root-user` when this kernel lets an unprivileged process use it."""
    if _unshare_state["ok"] is None:
        exe = shutil.which("unshare")
        ok = False
        if exe:
            try:
                ok = subprocess.run([exe, "--net", "--map-root-user", "true"], capture_output=True, timeout=10, env={"PATH": SAFE_PATH}).returncode == 0
            except (OSError, subprocess.SubprocessError):
                ok = False
        _unshare_state["ok"] = ok
    if _unshare_state["ok"]:
        return [shutil.which("unshare") or "unshare", "--net", "--map-root-user"]
    if not _unshare_state["warned"]:
        _unshare_state["warned"] = True
        log.warning("text-to-cad: unshare --net is not available here; the container's network policy must block egress for cadgen builds")
    return []


def _preexec(limits: Limits):
    def apply() -> None:  # runs in the child between fork and exec
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu_seconds, limits.cpu_seconds))
        resource.setrlimit(resource.RLIMIT_AS, (limits.address_space_bytes, limits.address_space_bytes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (limits.file_size_bytes, limits.file_size_bytes))
        resource.setrlimit(resource.RLIMIT_NOFILE, (limits.open_files, limits.open_files))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    return apply


@dataclass
class _Proc:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool
    elapsed_s: float


#: Indirection so tests can spy on exactly what is spawned (argv, env, cwd).
popen = subprocess.Popen


def _run(argv: list[str], *, cwd: Path, env: dict[str, str], limits: Limits, timeout_s: float, logs: Path) -> _Proc:
    logs.mkdir(parents=True, exist_ok=True)
    out_path, err_path = logs / "stdout.log", logs / "stderr.log"
    started = time.monotonic()
    with open(out_path, "wb") as out, open(err_path, "wb") as err:
        proc = popen(
            [*network_isolation_prefix(), *argv],
            cwd=str(cwd),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=err,
            preexec_fn=_preexec(limits),
            close_fds=True,
        )
        timed_out = False
        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
            proc.wait()
    return _Proc(proc.returncode, _tail(out_path), _tail(err_path), timed_out, time.monotonic() - started)


def _tail(path: Path) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - MAX_LOG_BYTES))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


_PATH_RE = re.compile(r"(?:[A-Za-z]:)?(?:/[^\s'\":,()]+)+")
_EXC_RE = re.compile(r"^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt|Failure|Fault)|AssertionError)(?::\s*(.*))?$")
_MODEL_LINE_RE = re.compile(r'File "[^"]*model\.py", line (\d+)')


def plain_failure(stderr: str, stdout: str = "") -> str:
    """The model's error in plain words: exception type + message + its line in model.py, with
    every filesystem path removed. Never the traceback."""
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    exc = None
    for ln in reversed(lines):
        m = _EXC_RE.match(ln)
        if m:
            exc = (m.group(1).rsplit(".", 1)[-1], (m.group(2) or "").strip())
            break
    if exc is None:
        for ln in reversed([*stdout.splitlines(), *lines]):
            try:
                obj = json.loads(ln)
            except ValueError:
                continue
            if isinstance(obj, dict) and obj.get("ok") is False:
                msg = obj.get("message") or obj.get("error") or ""
                if isinstance(msg, dict):
                    msg = msg.get("message", "")
                exc = ("", str(msg))
                break
    model_lines = _MODEL_LINE_RE.findall(stderr)
    where = f" on line {model_lines[-1]}" if model_lines else ""
    if exc is None:
        return f"The model stopped{where} without making a solid."
    kind, msg = exc
    msg = _PATH_RE.sub(lambda m: m.group(0).rsplit("/", 1)[-1], msg)
    detail = f"{kind}: {msg}" if kind and msg else (kind or msg or "unknown error")
    return f"The model failed{where}: {detail}"[:400]


def _artifact(kind: str, path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    return {
        "kind": kind,
        "filename": path.name,
        "content_base64": base64.b64encode(data).decode("ascii"),
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
    }


def failure(code: str, message: str, violations: list[tuple[int, str]] | None = None) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, "violations": [{"line": max(0, int(line)), "rule": rule} for line, rule in (violations or [])]}


def run_job(
    files: dict[str, bytes],
    *,
    entry: str,
    declared: dict[str, str],
    outputs: list[str],
    limits: Limits | None = None,
) -> dict[str, Any]:
    """Run `entry` (already gated, or one of our templates) in a fresh sandbox, then measure."""
    python = cadgen_python()
    if python is None:
        return failure("UNAVAILABLE", "3D model building is not installed on this CAD worker yet.")
    limits = limits or default_limits()
    wanted = [k for k in OUTPUT_KINDS if k in set(outputs)]
    if "step" not in declared:
        return failure("BUILD_FAILED", 'The model must export a STEP file: add @step(out="model.step").')
    missing = [k for k in wanted if k not in declared]
    if missing:
        return failure("BUILD_FAILED", f"The model does not export {', '.join(m.upper() for m in missing)}: add @{missing[0]}(out=\"model.{missing[0]}\").")

    root = Path(tempfile.mkdtemp(prefix="ttc-"))
    try:
        job, home, tool = root / "job", root / "home", root / "tool"
        for d in (job, home, home / "tmp", home / "cache", home / "state", tool):
            d.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            (job / name).write_bytes(data)
        shutil.copyfile(MEASURE_SCRIPT, tool / "measure.py")
        env = sandbox_env(home)
        started = time.monotonic()

        built = _run([python, "-I", entry, "--json"], cwd=job, env=env, limits=limits, timeout_s=limits.timeout_s, logs=root / "logs-build")
        if built.timed_out or (built.returncode in (-signal.SIGXCPU, -signal.SIGKILL) and built.elapsed_s >= limits.timeout_s - 1):
            return failure("TIMEOUT", f"Building the model took longer than {int(limits.timeout_s)} seconds. Try a simpler shape.")
        if built.returncode == -signal.SIGXCPU:
            return failure("TIMEOUT", "Building the model used too much computing time. Try a simpler shape.")
        if built.returncode == -signal.SIGXFSZ:
            return failure("TOO_LARGE", "The model's files grew past the size limit. Try fewer details.")
        if built.returncode != 0:
            if built.returncode == -signal.SIGKILL or "MemoryError" in built.stderr:
                return failure("BUILD_FAILED", "The model ran out of memory while building. Try a simpler shape.")
            return failure("BUILD_FAILED", plain_failure(built.stderr, built.stdout))

        paths: dict[str, Path] = {}
        for kind in {"step", *wanted}:
            p = job / declared[kind]
            if not p.is_file() or p.stat().st_size == 0:
                return failure("BUILD_FAILED", f"The model finished but wrote no {kind.upper()} file.")
            if p.stat().st_size > MAX_OUTPUT_BYTES:
                return failure("TOO_LARGE", f"The {kind.upper()} file is over {MAX_OUTPUT_BYTES // (1024 * 1024)} MB. Try fewer details.")
            paths[kind] = p

        measured = _run(
            [python, "-I", str(tool / "measure.py"), declared["step"]],
            cwd=job,
            env=env,
            limits=limits,
            timeout_s=MEASURE_TIMEOUT_S,
            logs=root / "logs-measure",
        )
        if measured.timed_out:
            return failure("TIMEOUT", "Checking the finished model took too long. Try a simpler shape.")
        geometry_raw = None
        for ln in reversed(measured.stdout.splitlines()):
            try:
                geometry_raw = json.loads(ln)
                break
            except ValueError:
                continue
        if measured.returncode != 0 or not isinstance(geometry_raw, dict):
            log.warning("text-to-cad: measure failed rc=%s", measured.returncode)
            return failure("BUILD_FAILED", "The model's STEP file could not be read back as a solid.")
        geometry = {
            "bbox_mm": [round(float(v), 4) for v in geometry_raw["bbox_mm"]],
            "volume_mm3": round(float(geometry_raw["volume_mm3"]), 3),
            "area_mm2": round(float(geometry_raw["area_mm2"]), 3),
            "solids": int(geometry_raw["solids"]),
            "sound": bool(geometry_raw["sound"]),
        }
        if geometry["solids"] == 0 or geometry["volume_mm3"] <= 0:
            return failure("BUILD_FAILED", "The model made no solid: return a closed 3D shape, not a sketch or a surface.")
        warnings: list[str] = []
        if geometry["solids"] > 1:
            warnings.append(f"The model is {geometry['solids']} separate solids; they print as separate pieces.")
        if not geometry["sound"]:
            warnings.append("The kernel's validity check found a problem in this solid (for example a self-intersection). Check it before ordering.")

        artifacts = [_artifact(kind, paths[kind]) for kind in wanted]
        return {
            "ok": True,
            "engine": {"name": ENGINE_NAME, "version": str(geometry_raw.get("engine_version") or PINNED_ENGINE_VERSION)},
            "artifacts": artifacts,
            "geometry": geometry,
            "warnings": warnings,
            "build_ms": int((time.monotonic() - started) * 1000),
        }
    finally:
        shutil.rmtree(root, ignore_errors=True)


def build_template(template: str, params: Any, outputs: list[str] | None = None, *, limits: Limits | None = None) -> dict[str, Any]:
    """One of OUR kid templates with already-validated params (a pydantic model). Trusted code,
    so it skips the gate, but it runs in exactly the same sandbox."""
    from .templates import OUTPUTS, template_files

    return run_job(template_files(template, params), entry="model.py", declared=dict(OUTPUTS), outputs=outputs or list(OUTPUT_KINDS), limits=limits)


def build_script(script: str, outputs: list[str], *, limits: Limits | None = None) -> dict[str, Any]:
    """Gate, then run a Make AI script. Nothing executes unless the gate passes."""
    gated = check(script)
    if gated.syntax_error:
        line, msg = gated.syntax_error
        return failure("BUILD_FAILED", f"The model is not valid Python (line {line}: {msg}).")
    if not gated.ok:
        return failure("GATE_REJECTED", "The model uses something that is not allowed, so it was not run.", gated.violations)
    return run_job({"model.py": script.encode("utf-8")}, entry="model.py", declared=gated.outputs, outputs=outputs, limits=limits)
