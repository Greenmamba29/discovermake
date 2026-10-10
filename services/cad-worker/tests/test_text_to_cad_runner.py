"""The sandboxed runner, the kid templates and the routes.

Tests that build for real need the cadgen environment: set CADGEN_PYTHON (and CADGEN_NODE for the
mesh exports) or they skip. The env spy, gate-before-run and route tests run everywhere.
"""

import base64
import hashlib
import os
import subprocess
import sys
import textwrap
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from cad_worker.app import create_app
from cad_worker.text_to_cad import runner
from cad_worker.text_to_cad.templates import TEMPLATES

HAS_CADGEN = runner.cadgen_python() is not None
needs_cadgen = pytest.mark.skipif(not HAS_CADGEN, reason="CADGEN_PYTHON is not set (cadgen venv)")

BOX = textwrap.dedent(
    """
    from cadgen import build123d as bd
    from cadgen import glb, step, stl


    @step(out="model.step")
    @glb(out="model.glb")
    @stl(out="model.stl")
    def model():
        body = bd.Box(40, 20, 6)
        body = bd.fillet(body.edges().filter_by(bd.Axis.Z), radius=3)
        for x in (-12, 12):
            body = body - bd.Pos(x, 0, 0) * bd.Cylinder(2.5, 10)
        return body


    if __name__ == "__main__":
        model()
    """
)


# ---------------------------------------------------------------------------
# Everywhere: environment, gate-before-run, unavailable
# ---------------------------------------------------------------------------


class SpyPopen:
    calls: list[dict] = []

    def __init__(self, argv, **kw):
        SpyPopen.calls.append({"argv": argv, **kw})
        self.pid = os.getpid()
        self.returncode = 1

    def wait(self, timeout=None):
        return 1


def test_build_env_has_telemetry_and_daemon_off_and_nothing_inherited(monkeypatch, tmp_path):
    monkeypatch.setenv("CADGEN_PYTHON", sys.executable)
    monkeypatch.setenv("CADGEN_NODE", sys.executable)
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "do-not-leak")
    monkeypatch.setenv("CAD_WORKER_TOKEN", "do-not-leak")
    SpyPopen.calls = []
    monkeypatch.setattr(runner, "popen", SpyPopen)
    result = runner.build_script(BOX, ["step", "glb", "stl"])
    assert result["ok"] is False and result["code"] == "BUILD_FAILED"
    call = SpyPopen.calls[0]
    env = call["env"]
    assert env["CADGEN_DAEMON"] == "0"
    assert env["CADGEN_TELEMETRY"] == "0"
    assert env["DO_NOT_TRACK"] == "1"
    assert env["CADGEN_UPDATE_CHECK"] == "0"
    assert env["CADGEN_NODE"] == sys.executable
    home = env["HOME"]
    assert env["CADGEN_CACHE_DIR"].startswith(home) and env["CADGEN_STATE_DIR"].startswith(home)
    assert "do-not-leak" not in env.values()
    assert set(env) <= {"PATH", "HOME", "TMPDIR", "CADGEN_CACHE_DIR", "CADGEN_STATE_DIR", "XDG_CACHE_HOME", "CADGEN_DAEMON", "CADGEN_TELEMETRY", "DO_NOT_TRACK", "CADGEN_UPDATE_CHECK", "PYTHONDONTWRITEBYTECODE", "LANG", "CADGEN_NODE"}
    # Isolated interpreter, the gated script, cwd = the fresh job folder (not the worker's).
    assert sys.executable in call["argv"] and "-I" in call["argv"] and "model.py" in call["argv"]
    assert call["cwd"].endswith("/job") and call["cwd"] != os.getcwd()
    assert call["preexec_fn"] is not None and call["stdin"] == subprocess.DEVNULL
    # The job folder is gone afterwards.
    assert not os.path.exists(call["cwd"])


def test_each_job_gets_a_fresh_home(monkeypatch):
    monkeypatch.setenv("CADGEN_PYTHON", sys.executable)
    SpyPopen.calls = []
    monkeypatch.setattr(runner, "popen", SpyPopen)
    runner.build_script(BOX, ["step"])
    runner.build_script(BOX, ["step"])
    homes = [c["env"]["HOME"] for c in SpyPopen.calls]
    assert len(homes) == 2 and homes[0] != homes[1]


def test_gate_rejection_runs_nothing(monkeypatch):
    monkeypatch.setenv("CADGEN_PYTHON", sys.executable)
    SpyPopen.calls = []
    monkeypatch.setattr(runner, "popen", SpyPopen)
    result = runner.build_script(BOX.replace("from cadgen import glb", "import os\nfrom cadgen import glb"), ["step"])
    assert result["code"] == "GATE_REJECTED"
    assert result["violations"] == [{"line": 3, "rule": "import of 'os' is not allowed (only math, typing and cadgen)"}]
    assert SpyPopen.calls == []


def test_unavailable_without_cadgen(monkeypatch):
    monkeypatch.delenv("CADGEN_PYTHON", raising=False)
    result = runner.build_script(BOX, ["step"])
    assert result == {"ok": False, "code": "UNAVAILABLE", "message": result["message"], "violations": []}
    assert "/" not in result["message"]


def test_requested_output_must_be_declared(monkeypatch):
    monkeypatch.setenv("CADGEN_PYTHON", sys.executable)
    script = BOX.replace('@glb(out="model.glb")\n', "")
    result = runner.build_script(script, ["step", "glb"])
    assert result["code"] == "BUILD_FAILED" and "GLB" in result["message"]


def test_plain_failure_hides_paths_and_tracebacks():
    stderr = 'Traceback (most recent call last):\n  File "/tmp/ttc-abc/job/model.py", line 12, in model\n    x\nValueError: bad value in /tmp/ttc-abc/job/thing.step\n'
    msg = runner.plain_failure(stderr)
    assert msg == "The model failed on line 12: ValueError: bad value in thing.step"
    assert runner.plain_failure("", '{"ok":false,"error":"Failed creating a fillet"}') == "The model failed: Failed creating a fillet"


# ---------------------------------------------------------------------------
# Real builds (cadgen venv)
# ---------------------------------------------------------------------------


@needs_cadgen
def test_builds_step_glb_stl_with_sane_geometry():
    result = runner.build_script(BOX, ["step", "glb", "stl"])
    assert result["ok"] is True, result
    assert result["engine"] == {"name": "cadgen", "version": "0.7.20"}
    kinds = [a["kind"] for a in result["artifacts"]]
    assert kinds == ["step", "glb", "stl"]
    for a in result["artifacts"]:
        data = base64.b64decode(a["content_base64"])
        assert len(data) == a["bytes"] > 100
        assert hashlib.sha256(data).hexdigest() == a["sha256"]
    step = base64.b64decode(result["artifacts"][0]["content_base64"])
    assert step.startswith(b"ISO-10303-21")
    assert base64.b64decode(result["artifacts"][1]["content_base64"])[:4] == b"glTF"
    g = result["geometry"]
    assert g["bbox_mm"] == pytest.approx([40, 20, 6], abs=0.01)
    hole = 3.141592653589793 * 2.5**2 * 6 * 2
    corners = (4 - 3.141592653589793) * 3**2 * 6
    assert g["volume_mm3"] == pytest.approx(40 * 20 * 6 - hole - corners, rel=1e-3)
    assert g["solids"] == 1 and g["sound"] is True and g["area_mm2"] > 0
    assert result["warnings"] == [] and result["build_ms"] > 0


@needs_cadgen
def test_model_error_is_build_failed_in_plain_words():
    script = BOX.replace("radius=3", "radius=50")
    result = runner.build_script(script, ["step"])
    assert result["ok"] is False and result["code"] == "BUILD_FAILED"
    assert "fillet" in result["message"].lower()
    assert "/tmp" not in result["message"] and "Traceback" not in result["message"]


@needs_cadgen
def test_timeout_kills_the_build():
    script = BOX.replace("body = bd.Box(40, 20, 6)", "while True:\n        pass\n    body = bd.Box(40, 20, 6)")
    result = runner.build_script(script, ["step"], limits=runner.Limits(timeout_s=6))
    assert result["ok"] is False and result["code"] == "TIMEOUT"


# Expected bounding boxes (mm, x y z) with a tolerance: kid-safe printable sizes.
TEMPLATE_CASES = {
    "name_keychain": ({"label": "Mia", "color": "purple"}, (30, 95), (19.5, 20.5), (4.0, 4.4)),
    "phone_stand": ({"color": "blue", "angle": "medium", "label": "Sam"}, (89, 91), (60, 90), (69.5, 70.5)),
    "bookmark": ({"label": "Reading Rex", "color": "yellow", "shape": "star"}, (147, 150.5), (39.5, 40.5), (2.7, 2.9)),
    "desk_tidy": ({"color": "white", "cups": 3, "label": "Max"}, (148, 152), (69, 71), (89.5, 90.5)),
    "bike_hook": ({"color": "red", "label": "Helmet"}, (39.5, 40.5), (69.5, 70.5), (59.5, 60.5)),
}


@pytest.fixture(scope="module")
def template_results():
    if not HAS_CADGEN:
        pytest.skip("CADGEN_PYTHON is not set (cadgen venv)")

    def build(item):
        name, (params, *_bounds) = item
        return name, runner.build_template(name, TEMPLATES[name].model_validate(params))

    with ThreadPoolExecutor(max_workers=3) as ex:
        return dict(ex.map(build, TEMPLATE_CASES.items()))


@pytest.mark.parametrize("name", list(TEMPLATE_CASES))
def test_each_template_builds_within_bounds(template_results, name):
    result = template_results[name]
    assert result["ok"] is True, result
    _params, bx, by, bz = TEMPLATE_CASES[name]
    x, y, z = result["geometry"]["bbox_mm"]
    assert bx[0] <= x <= bx[1] and by[0] <= y <= by[1] and bz[0] <= z <= bz[1], (name, x, y, z)
    assert result["geometry"]["solids"] == 1 and result["geometry"]["sound"] is True
    assert [a["kind"] for a in result["artifacts"]] == ["step", "glb", "stl"]


def test_template_params_are_validated():
    with pytest.raises(Exception):
        TEMPLATES["name_keychain"].model_validate({"label": "Mia!", "color": "purple"})
    with pytest.raises(Exception):
        TEMPLATES["name_keychain"].model_validate({"label": "x" * 13, "color": "purple"})
    with pytest.raises(Exception):
        TEMPLATES["desk_tidy"].model_validate({"color": "white", "cups": 5})
    with pytest.raises(Exception):
        TEMPLATES["bike_hook"].model_validate({"color": "pink"})
    assert TEMPLATES["name_keychain"].model_validate({"label": "  Mia ", "color": "red"}).label == "Mia"


def test_template_params_travel_as_data_not_code():
    from cad_worker.text_to_cad.templates import template_files

    files = template_files("name_keychain", TEMPLATES["name_keychain"].model_validate({"label": "Zed", "color": "red"}))
    assert b"Zed" not in files["model.py"]
    assert files["params.json"] == b'{"label": "Zed", "color": "red", "size": "small"}'
    assert files["label-font.ttf"][:4] in (b"\x00\x01\x00\x00", b"true", b"OTTO")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("CAD_WORKER_TOKEN", "test-token")
    with TestClient(create_app()) as c:
        yield c


AUTH = {"Authorization": "Bearer test-token"}


def test_routes_need_the_bearer_token(client):
    assert client.post("/v1/text-to-cad/build", json={"script": BOX}).status_code == 401
    assert client.post("/v1/kid-templates/bookmark/build", json={"template": "bookmark", "params": {}}).status_code == 401


def test_route_gate_rejection(client):
    r = client.post("/v1/text-to-cad/build", json={"script": "import os\n"}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and body["code"] == "GATE_REJECTED"
    assert {"line": 1, "rule": "import of 'os' is not allowed (only math, typing and cadgen)"} in body["violations"]


def test_route_validation(client):
    assert client.post("/v1/text-to-cad/build", json={"script": ""}, headers=AUTH).status_code == 422
    assert client.post("/v1/text-to-cad/build", json={"script": BOX, "outputs": ["dxf"]}, headers=AUTH).status_code == 422
    assert client.post("/v1/kid-templates/rocket/build", json={"template": "rocket", "params": {}}, headers=AUTH).status_code == 404
    r = client.post("/v1/kid-templates/name_keychain/build", json={"template": "name_keychain", "params": {"label": "hi@x.com", "color": "red"}}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED"
    r = client.post("/v1/kid-templates/bike_hook/build", json={"template": "bookmark", "params": {"color": "red"}}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED"
    assert client.post("/v1/kid-templates/bike_hook/build", json={"params": {"color": "red"}}, headers=AUTH).status_code == 422
    big = {"script": "#" * 300_000}
    assert client.post("/v1/text-to-cad/build", json=big, headers=AUTH).status_code == 413


def test_route_unavailable_is_503(client, monkeypatch):
    monkeypatch.delenv("CADGEN_PYTHON", raising=False)
    r = client.post("/v1/text-to-cad/build", json={"script": BOX}, headers=AUTH)
    assert r.status_code == 503 and r.json()["code"] == "UNAVAILABLE"
    r = client.post("/v1/kid-templates/bike_hook/build", json={"template": "bike_hook", "params": {"color": "red"}}, headers=AUTH)
    assert r.status_code == 503 and r.json()["code"] == "UNAVAILABLE"


@needs_cadgen
def test_route_builds_a_template(client):
    r = client.post("/v1/kid-templates/bike_hook/build", json={"template": "bike_hook", "params": {"color": "green"}}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["engine"]["name"] == "cadgen"
    assert {a["kind"] for a in body["artifacts"]} == {"step", "glb", "stl"}
