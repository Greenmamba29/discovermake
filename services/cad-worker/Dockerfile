# DiscoverMake CAD worker (R2). Runs outside Vercel (Fly.io / Render / Cloud Run):
# OpenCascade needs native libraries and more memory than a serverless function.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 cad
WORKDIR /app
COPY pyproject.toml ./
COPY cad_worker ./cad_worker
RUN pip install --no-cache-dir .

USER cad
ENV PORT=8080 CAD_WORKER_TIMEOUT_S=30 CAD_WORKER_CONCURRENCY=2
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz')"
CMD ["python", "-m", "cad_worker.app"]
