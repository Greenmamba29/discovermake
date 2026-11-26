"""SolidCraft engine: the gate, parameter overrides, the sandboxed runner and the route.

Real builds need the engine binary: set SOLIDCRAFT_CLI (Docker: /opt/solidcraft/bin/solidcraft-cli)
or they skip. The gate, override, env-spy and route tests run everywhere.
"""

import base64
import hashlib
import math
import os

import pytest
from fastapi.testclient import TestClient

from cad_worker.app import create_app
from cad_worker.solidcraft import gate, runner
from cad_worker.text_to_cad import runner as ttc_runner

HAS_CLI = runner.solidcraft_cli() is not None
needs_cli = pytest.mark.skipif(not HAS_CLI, reason="SOLIDCRAFT_CLI is not set")

#: SolidCraft's own examples/bracket.json (MIT OR Apache-2.0): an L bracket with two holes.
BRACKET = {
    "commands": [
        {"command": "parameters.change", "params": {"name": "width", "expression": "60 mm"}},
        {"command": "parameters.change", "params": {"name": "thickness", "expression": "6 mm"}},
        {"command": "sketch.create", "params": {"plane": "XZ", "name": "Profile"}},
        {"command": "sketch.line", "params": {"points": [[0, 0], [40, 0], [40, 6], [6, 6], [6, 30], [0, 30]], "closed": True, "ids": ["a", "b", "c", "d", "e", "f"]}},
        {"command": "sketch.finish", "params": {}},
        {"command": "solid.extrude", "params": {"distance": "width", "direction": "negative", "body_name": "Bracket"}},
        {"command": "solid.fillet", "params": {"edges": [[40, -30, -6]], "radius": 2}},
        {"command": "sketch.create", "params": {"plane": "XY", "name": "Holes"}},
        {"command": "sketch.circle.center", "params": {"center": [25, -15], "diameter": 8}},
        {"command": "sketch.circle.center", "params": {"center": [25, -45], "diameter": 8}},
        {"command": "sketch.finish", "params": {}},
        {"command": "solid.extrude", "params": {"distance": "thickness", "direction": "negative", "operation": "cut"}},
    ]
}
BOX = {
    "commands": [
        {"command": "parameters.change", "params": {"name": "L", "expression": "30 mm"}},
        {"command": "solid.box", "params": {"length": "L", "width": 20, "height": 10, "body_name": "Box"}},
    ]
}


# ---------------------------------------------------------------------------
# Gate: data only, modelling commands only, nothing that reaches a file
# ---------------------------------------------------------------------------


def rules(script):
    r = gate.check(script)
    return r.ok, [rule for _, rule in r.violations]


def test_gate_accepts_a_real_modelling_script():
    ok, why = rules(BRACKET)
    assert ok, why


@pytest.mark.parametrize(
    "step, needle",
    [
        ({"command": "file.export", "params": {"path": "x.step"}}, "not a modelling command"),
        ({"command": "file.insert_step", "params": {"path": "/etc/passwd"}}, "not a modelling command"),
        ({"command": "plugin.run", "params": {"approval": "abc"}}, "not a modelling command"),
        ({"command": "sketch.insert_svg", "params": {"text": "<svg/>"}}, "not a modelling command"),
        ({"command": "timeline.export_script", "params": {}}, "not a modelling command"),
        ({"command": "parameters.import", "params": {"text": "a,b"}}, "not a modelling command"),
        ({"command": "sheet.export_dxf", "params": {}}, "not a modelling command"),
        ({"command": "solid.sweep", "params": {"sketch": "S", "path_sketch": "P", "path": "/etc/shadow"}}, "never a file path"),
        ({"command": "solid.sweep", "params": {"sketch": "S", "path_sketch": "P", "path": ["../x.step"]}}, "never a file path"),
        ({"command": "sketch.text", "params": {"text": "hi", "at": [0, 0], "font": "/usr/share/fonts/x.ttf"}}, "font family"),
        ({"command": "solid.box", "params": {"length": 1, "width": 1, "height": 1, "file": "a"}}, "cannot read or write files"),
        ({"command": "appearance.assign", "params": {"appearance": {"texture": "a.png"}}}, "cannot read or write files"),
        ({"command": "sketch.text", "params": {"text": "~/.ssh/id_rsa", "at": [0, 0]}}, "looks like a file path"),
        ({"command": "sketch.text", "params": {"text": "http://evil.example/x", "at": [0, 0]}}, "looks like a file path"),
        ({"command": "solid.box", "params": {"length": float("inf"), "width": 1, "height": 1}}, "plain JSON"),
    ],
)
def test_gate_rejects_anything_that_reaches_outside(step, needle):
    ok, why = rules({"commands": [*BOX["commands"], step]})
    assert not ok
    assert any(needle in w for w in why), why


def test_gate_allows_curve_id_paths_and_font_families():
    script = {
        "commands": [
            {"command": "solid.sweep", "params": {"sketch": "Profile", "path_sketch": "Path", "path": ["l1", "a2", 3]}},
            {"command": "sketch.text", "params": {"text": "Pi 4", "at": [0, 0], "font": "DejaVu Sans"}},
            {"command": "solid.extrude", "params": {"distance": "w/2 - wall"}},
        ]
    }
    ok, why = rules(script)
    assert ok, why


def test_gate_bounds_shape_and_size():
    assert rules({"commands": []})[0] is False
    assert rules({"commands": BOX["commands"], "extra": 1})[0] is False
    assert rules({"commands": [{"command": "solid.box", "params": {}, "x": 1}]})[0] is False
    assert rules({"commands": [BOX["commands"][1]] * (gate.MAX_COMMANDS + 1)})[0] is False
    deep: dict = {}
    cur = deep
    for _ in range(gate.MAX_DEPTH + 2):
        cur["a"] = {}
        cur = cur["a"]
    assert rules({"commands": [{"command": "solid.box", "params": deep}]})[0] is False
    assert rules({"commands": [{"command": "sketch.text", "params": {"text": "x" * (gate.MAX_STRING + 1)}}]})[0] is False


def test_negative_control_every_allowed_command_is_a_modelling_command():
    # If the allow-list ever gains a file, doc, plugin or export command, this fails.
    prefixes = ("file.", "doc.", "document.", "plugin.", "ui.", "app.", "window.", "storage.", "library.", "render.", "view.", "settings.", "panel.", "tab.")
    leaked = sorted(c for c in gate.ALLOWED_COMMANDS if c.startswith(prefixes) or "export" in c or "import" in c or c.startswith("sketch.insert_") or "paste" in c or c.endswith(".manage_rules"))
    assert leaked == []
    assert {"solid.extrude", "sketch.create", "parameters.change", "sheet.flange", "inspect.measure"} <= gate.ALLOWED_COMMANDS


# ---------------------------------------------------------------------------
# New sizes: checked before the saved design is opened
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides, needle",
    [
        ({}, "Change at least one size"),
        ({"width": "'; drop"}, "must be a number"),
        ({"width": "80 mm --allow-any-path"}, "must be a number"),
        ({"width": "a=b"}, "must be a number"),
        ({"9bad": "1 mm"}, "not a parameter name"),
    ],
)
def test_overrides_refuse_unsafe_names_and_values(overrides, needle):
    with pytest.raises(runner.DesignError, match=needle):
        runner.check_overrides(overrides)


def test_rebuild_refuses_a_design_it_did_not_write(monkeypatch):
    spawned = []
    monkeypatch.setattr(ttc_runner, "popen", lambda *a, **k: spawned.append(a) or (_ for _ in ()).throw(AssertionError("spawned")))
    data = b"PK\x03\x04" + b"x" * 100
    out = runner.rebuild_design(data, "0" * 64, {"L": "80 mm"}, ["step"])
    assert out["code"] == "GATE_REJECTED" and "checksum" in out["message"]
    fake = b"not a zip at all"
    out = runner.rebuild_design(fake, hashlib.sha256(fake).hexdigest(), {"L": "80 mm"}, ["step"])
    assert out["code"] == "GATE_REJECTED" and "not a saved SolidCraft design" in out["message"]
    assert spawned == []


# ---------------------------------------------------------------------------
# Everywhere: environment, gate-before-run, unavailable
# ---------------------------------------------------------------------------


def test_unavailable_without_the_engine(monkeypatch):
    monkeypatch.delenv("SOLIDCRAFT_CLI", raising=False)
    out = runner.build_commands(BOX, ["step"])
    assert out == {"ok": False, "code": "UNAVAILABLE", "message": "The SolidCraft engine is not installed on this CAD worker yet.", "violations": []}


def test_gate_runs_before_anything_spawns(monkeypatch):
    spawned = []
    monkeypatch.setattr(ttc_runner, "popen", lambda *a, **k: spawned.append(a) or (_ for _ in ()).throw(AssertionError("spawned")))
    out = runner.build_commands({"commands": [{"command": "file.export", "params": {"path": "/tmp/x.step"}}]}, ["step"])
    assert out["ok"] is False and out["code"] == "GATE_REJECTED"
    assert out["violations"][0]["line"] == 1
    assert spawned == []


def test_sandbox_env_inherits_nothing_and_turns_telemetry_off(tmp_path, monkeypatch):
    monkeypatch.setenv("CAD_WORKER_TOKEN", "secret-token-value")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "nope")
    env = runner.sandbox_env(tmp_path)
    assert env["SOLIDCRAFT_NO_TELEMETRY"] == "1" and env["DO_NOT_TRACK"] == "1" and env["SOLIDCRAFT_UPDATE_CHECK"] == "0"
    assert "CAD_WORKER_TOKEN" not in env and "AWS_SECRET_ACCESS_KEY" not in env
    assert all(v.startswith(str(tmp_path)) for k, v in env.items() if k in ("HOME", "TMPDIR", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"))


# ---------------------------------------------------------------------------
# Real builds (need SOLIDCRAFT_CLI)
# ---------------------------------------------------------------------------


def _check_artifacts(out, kinds):
    assert [a["kind"] for a in out["artifacts"]] == kinds
    for a in out["artifacts"]:
        data = base64.b64decode(a["content_base64"])
        assert len(data) == a["bytes"] and hashlib.sha256(data).hexdigest() == a["sha256"]
        assert a["filename"] == f"model.{a['kind']}"
    step = next((a for a in out["artifacts"] if a["kind"] == "step"), None)
    if step:
        assert base64.b64decode(step["content_base64"]).startswith(b"ISO-10303-21;")


@needs_cli
def test_real_box_is_measured_exactly():
    out = runner.build_commands(BOX, ["step", "glb", "stl"])
    assert out["ok"], out
    _check_artifacts(out, ["step", "glb", "stl"])
    g = out["geometry"]
    assert g["bbox_mm"] == [30.0, 20.0, 10.0]
    assert g["volume_mm3"] == pytest.approx(6000.0, abs=1e-3)
    assert g["area_mm2"] == pytest.approx(2200.0, abs=1e-3)
    assert g["solids"] == 1 and g["sound"] is True
    assert out["engine"]["name"] == "solidcraft" and out["engine"]["version"][0].isdigit()
    assert out["parameters"] == [{"name": "L", "expression": "30 mm", "value": 30.0, "unit": "mm", "comment": ""}]
    assert out["script"]["commands"] == BOX["commands"]
    assert out["design"]["filename"] == "model.sc" and out["design"]["bytes"] > 0


#: A block with filleted corners: its fillet picks are plain points, as Make AI writes them.
HOLDER = {
    "commands": [
        {"command": "parameters.add", "params": {"name": "L", "expression": "60 mm", "comment": "overall length"}},
        {"command": "parameters.add", "params": {"name": "W", "expression": "24 mm", "comment": "depth"}},
        {"command": "parameters.add", "params": {"name": "H", "expression": "18 mm", "comment": "height"}},
        {"command": "solid.box", "params": {"length": "L", "width": "W", "height": "H", "center": [0, 0, "H/2"], "body_name": "Holder"}},
        {"command": "solid.fillet", "params": {"edges": [[30, 12, 9], [-30, 12, 9], [30, -12, 9], [-30, -12, 9]], "radius": 3, "name": "Corners"}},
    ]
}


def _design(out):
    return base64.b64decode(out["design"]["content_base64"]), out["design"]["sha256"]


@needs_cli
def test_real_new_sizes_rebuild_from_the_saved_design():
    base = runner.build_commands(HOLDER, ["step"])
    assert base["ok"], base
    assert base["geometry"]["bbox_mm"] == [60.0, 24.0, 18.0]
    data, sha = _design(base)
    assert data[:4] == b"PK\x03\x04" and hashlib.sha256(data).hexdigest() == sha and base["design"]["filename"] == "model.sc"
    wide = runner.rebuild_design(data, sha, {"L": "80 mm"}, ["step", "stl"])
    assert wide["ok"], wide
    # The corner fillets follow their edges to the new length: the bbox and volume change, the faces do not.
    assert wide["geometry"]["bbox_mm"] == [80.0, 24.0, 18.0]
    assert wide["geometry"]["volume_mm3"] == pytest.approx(80 * 24 * 18 - 4 * 9 * (1 - math.pi / 4) * 18, abs=0.05)
    assert {p["name"]: p["expression"] for p in wide["parameters"]} == {"L": "80 mm", "W": "24 mm", "H": "18 mm"}
    assert "script" not in wide
    # Negative control: replaying the SCRIPT with the new length misses the fillet edges.
    replay = {"commands": [{**HOLDER["commands"][0], "params": {**HOLDER["commands"][0]["params"], "expression": "80 mm"}}, *HOLDER["commands"][1:]]}
    bad = runner.build_commands(replay, ["step"])
    assert bad["code"] == "BUILD_FAILED" and bad["message"].startswith("Step 5 (solid.fillet)")


@needs_cli
def test_real_size_the_model_cannot_take_is_a_plain_error():
    base = runner.build_commands(HOLDER, ["step"])
    data, sha = _design(base)
    out = runner.rebuild_design(data, sha, {"L": "5 mm"}, ["step"])
    assert out["ok"] is False and out["code"] == "BUILD_FAILED"
    assert out["message"].startswith("Corners: ") and "largest radius that fits" in out["message"]
    out = runner.rebuild_design(data, sha, {"nope": "5 mm"}, ["step"])
    assert out["code"] == "BUILD_FAILED" and "nope" in out["message"]


@needs_cli
def test_real_engine_errors_come_back_plain_for_the_repair_loop():
    bad = {"commands": [*BOX["commands"], {"command": "solid.fillet", "params": {"edges": [[300, 300, 300]], "radius": 2}}]}
    out = runner.build_commands(bad, ["step"])
    assert out["ok"] is False and out["code"] == "BUILD_FAILED"
    assert out["message"].startswith("Step 3 (solid.fillet): ")
    assert "/" not in out["message"].split(": ", 1)[1].replace("mm", "")  # no server paths
    typo = {"commands": [{"command": "solid.box", "params": {"length": 1, "widht": 1, "height": 1}}]}
    out = runner.build_commands(typo, ["step"])
    assert out["code"] == "BUILD_FAILED" and "unknown key `widht`" in out["message"]
    sketch_only = {"commands": [{"command": "sketch.create", "params": {"plane": "XY"}}, {"command": "sketch.circle.center", "params": {"center": [0, 0], "diameter": 10}}, {"command": "sketch.finish", "params": {}}]}
    out = runner.build_commands(sketch_only, ["step"])
    assert out["code"] == "BUILD_FAILED" and "made no solid" in out["message"]


@needs_cli
def test_real_timeout_kills_the_build():
    from cad_worker.text_to_cad.runner import Limits

    heavy = {"commands": [{"command": "solid.box", "params": {"length": 10, "width": 10, "height": 10}}] + [{"command": "solid.cylinder", "params": {"base": [i % 9, 0, 0], "diameter": 0.5, "height": 40, "operation": "cut"}} for i in range(300)]}
    out = runner.build_commands(heavy, ["step"], limits=Limits(timeout_s=0.5))
    assert out["code"] == "TIMEOUT", out


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("CAD_WORKER_TOKEN", "t0ken")
    return TestClient(create_app())


AUTH = {"authorization": "Bearer t0ken"}


def test_route_needs_the_token(client):
    assert client.post("/v1/solidcraft/build", json={"script": BOX}).status_code == 401


def test_route_validates_the_body(client):
    r = client.post("/v1/solidcraft/build", json={"script": BOX, "nope": 1}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED"
    r = client.post("/v1/solidcraft/build", json={"script": BOX, "outputs": ["dxf"]}, headers=AUTH)
    assert r.status_code == 422


def test_route_gate_rejection_is_200_with_violations(client):
    r = client.post("/v1/solidcraft/build", json={"script": {"commands": [{"command": "file.export", "params": {"path": "x"}}]}}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and body["code"] == "GATE_REJECTED" and body["violations"][0]["line"] == 1


def test_route_unavailable_is_503(client, monkeypatch):
    monkeypatch.delenv("SOLIDCRAFT_CLI", raising=False)
    r = client.post("/v1/solidcraft/build", json={"script": BOX}, headers=AUTH)
    assert r.status_code == 503 and r.json()["code"] == "UNAVAILABLE"


@needs_cli
def test_route_builds_then_rebuilds_with_new_sizes(client):
    r = client.post("/v1/solidcraft/build", json={"script": BOX, "outputs": ["step", "stl"]}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and [a["kind"] for a in body["artifacts"]] == ["step", "stl"]
    design = {"content_base64": body["design"]["content_base64"], "sha256": body["design"]["sha256"]}
    r = client.post("/v1/solidcraft/rebuild", json={"design": design, "parameters": {"L": "45 mm"}, "outputs": ["step"]}, headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["geometry"]["bbox_mm"] == [45.0, 20.0, 10.0]


def test_rebuild_route_validates(client):
    r = client.post("/v1/solidcraft/rebuild", json={"design": {"content_base64": "!!!!", "sha256": "0" * 64}, "parameters": {"L": "1 mm"}}, headers=AUTH)
    assert r.status_code == 422
    r = client.post("/v1/solidcraft/rebuild", json={"design": {"content_base64": "UEsDBA==", "sha256": "0" * 64}, "parameters": {}}, headers=AUTH)
    assert r.status_code == 422


def test_healthz_reports_the_engines(client, monkeypatch):
    monkeypatch.delenv("SOLIDCRAFT_CLI", raising=False)
    assert client.get("/healthz").json()["engines"]["solidcraft"] is None


@needs_cli
def test_healthz_reports_the_solidcraft_version(client):
    assert client.get("/healthz").json()["engines"]["solidcraft"] == runner.PINNED_ENGINE_VERSION
