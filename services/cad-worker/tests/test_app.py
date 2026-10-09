import base64
import hashlib

import pytest
from fastapi.testclient import TestClient

from cad_worker.app import create_app

from .test_generate import BRACKET, PANEL


@pytest.fixture(scope="module")
def client():
    mp = pytest.MonkeyPatch()
    mp.setenv("CAD_WORKER_TOKEN", "test-token")
    mp.setenv("CAD_WORKER_TIMEOUT_S", "120")
    with TestClient(create_app()) as c:
        yield c
    mp.undo()


AUTH = {"Authorization": "Bearer test-token"}


def test_requires_token_configured(monkeypatch):
    monkeypatch.delenv("CAD_WORKER_TOKEN", raising=False)
    monkeypatch.delenv("CAD_WORKER_ALLOW_NO_AUTH", raising=False)
    with pytest.raises(RuntimeError):
        create_app()


def test_healthz(client):
    assert client.get("/healthz").json()["ok"] is True


def test_rejects_missing_or_wrong_token(client):
    assert client.post("/v1/generate", json={"spec": PANEL}).status_code == 401
    assert client.post("/v1/generate", json={"spec": PANEL}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_validation_error_is_422(client):
    r = client.post("/v1/generate", json={"spec": {**PANEL, "width_mm": -1}}, headers=AUTH)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_FAILED"


def test_oversized_body_is_413(client):
    r = client.post("/v1/generate", content=b"{" + b" " * 70_000 + b"}", headers={**AUTH, "Content-Type": "application/json"})
    assert r.status_code == 413


def test_generate_bracket_end_to_end(client):
    r = client.post("/v1/generate", json={"spec": BRACKET, "ref": "bld_x@v2"}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ref"] == "bld_x@v2"
    assert body["family"] == "l_bracket"
    kinds = {a["kind"] for a in body["artifacts"]}
    assert kinds == {"DXF", "STEP", "GLB", "BOM", "CSV", "SVG", "MANIFEST"}
    for a in body["artifacts"]:
        data = base64.b64decode(a["content_base64"])
        assert len(data) == a["bytes"]
        assert hashlib.sha256(data).hexdigest() == a["sha256"]
    assert body["metrics"]["bend_count"] == 1
