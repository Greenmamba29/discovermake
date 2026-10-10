"""HTTP API for the CAD worker.

    GET  /healthz             -> {"ok": true, "version": ...}
    POST /v1/generate         GenerateRequest -> GenerateResponse   (Bearer CAD_WORKER_TOKEN)

Each generation runs in a separate process with a hard timeout, so a pathological
spec that slips past validation cannot hang the server or leak memory into it.

Environment:
    CAD_WORKER_TOKEN        required unless CAD_WORKER_ALLOW_NO_AUTH=1 (local dev only)
    CAD_WORKER_TIMEOUT_S    per-request generation timeout (default 30)
    CAD_WORKER_CONCURRENCY  max parallel generations (default 2)
"""

from __future__ import annotations

import asyncio
import hmac
import multiprocessing as mp
import os
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from . import __version__
from .generate import generate
from .specs import GenerateRequest

MAX_BODY_BYTES = 64 * 1024  # specs are small; anything bigger is not a spec


def _settings() -> dict:
    token = os.environ.get("CAD_WORKER_TOKEN", "")
    allow_no_auth = os.environ.get("CAD_WORKER_ALLOW_NO_AUTH") == "1"
    if not token and not allow_no_auth:
        raise RuntimeError("CAD_WORKER_TOKEN is required (set CAD_WORKER_ALLOW_NO_AUTH=1 only for local development)")
    return {
        "token": token,
        "timeout_s": float(os.environ.get("CAD_WORKER_TIMEOUT_S", "30")),
        "concurrency": int(os.environ.get("CAD_WORKER_CONCURRENCY", "2")),
    }


def _run(payload: dict) -> dict:
    """Runs in a worker process."""
    req = GenerateRequest.model_validate(payload)
    started = time.monotonic()
    result = generate(req.spec, worker_version=__version__).to_json()
    result["ref"] = req.ref
    result["duration_ms"] = int((time.monotonic() - started) * 1000)
    result["worker_version"] = __version__
    return result


def create_app() -> FastAPI:
    settings = _settings()
    app = FastAPI(title="DiscoverMake CAD worker", version=__version__, docs_url=None, redoc_url=None)
    state: dict = {"pool": None}
    sem = asyncio.Semaphore(settings["concurrency"])

    def pool() -> ProcessPoolExecutor:
        if state["pool"] is None:
            state["pool"] = ProcessPoolExecutor(max_workers=settings["concurrency"], mp_context=mp.get_context("spawn"))
        return state["pool"]

    def reset_pool() -> None:
        p, state["pool"] = state["pool"], None
        if p is not None:
            procs = list((getattr(p, "_processes", None) or {}).values())
            p.shutdown(wait=False, cancel_futures=True)
            for proc in procs:
                if proc.is_alive():
                    proc.kill()

    def auth(request: Request) -> None:
        if not settings["token"]:
            return
        header = request.headers.get("authorization", "")
        scheme, _, given = header.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(given.strip().encode(), settings["token"].encode()):
            raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Missing or invalid bearer token"})

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "version": __version__}

    @app.post("/v1/generate", dependencies=[Depends(auth)])
    async def generate_route(request: Request) -> JSONResponse:
        length = request.headers.get("content-length")
        if length is not None and int(length) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail={"code": "PAYLOAD_TOO_LARGE", "message": "Spec too large"})
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail={"code": "PAYLOAD_TOO_LARGE", "message": "Spec too large"})
        try:
            req = GenerateRequest.model_validate_json(body)
        except ValidationError as e:
            return JSONResponse(
                status_code=422,
                content={"error": {"code": "VALIDATION_FAILED", "message": "Invalid CadSpec", "details": e.errors(include_url=False, include_context=False)}},
            )
        async with sem:
            loop = asyncio.get_running_loop()
            fut = loop.run_in_executor(pool(), _run, req.model_dump(mode="json"))
            try:
                result = await asyncio.wait_for(fut, timeout=settings["timeout_s"])
            except asyncio.TimeoutError:
                reset_pool()  # kill the stuck worker process
                return JSONResponse(status_code=504, content={"error": {"code": "TIMEOUT", "message": "CAD generation timed out"}})
            except BrokenProcessPool:
                reset_pool()
                return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL", "message": "CAD worker process crashed"}})
            except Exception as e:  # geometry kernel failures (e.g. fillet too large) are the caller's spec problem
                return JSONResponse(status_code=422, content={"error": {"code": "GEOMETRY_FAILED", "message": str(e)[:500]}})
        return JSONResponse(content=result)

    app.router.on_shutdown.append(reset_pool)
    return app


def main() -> None:  # pragma: no cover - entrypoint
    import uvicorn

    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), workers=1)


if __name__ == "__main__":  # pragma: no cover
    main()
