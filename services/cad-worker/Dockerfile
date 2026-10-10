# DiscoverMake CAD worker (R2). Runs outside Vercel (Fly.io / Render / Cloud Run):
# OpenCascade needs native libraries and more memory than a serverless function.
FROM python:3.12-slim

# util-linux gives `unshare` (per-build empty network namespace, when the host allows user
# namespaces); curl + xz fetch Node for cadgen's mesh exports.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxrender1 util-linux ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (cadgen exports GLB / STL meshes through Node >= 20).
ARG NODE_VERSION=22.11.0
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) n=x64 ;; arm64) n=arm64 ;; *) echo "unsupported arch $arch" && exit 1 ;; esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${n}.tar.xz" -o /tmp/node.tar.xz \
    && mkdir -p /opt/node22 && tar -xJf /tmp/node.tar.xz -C /opt/node22 --strip-components=1 \
    && rm /tmp/node.tar.xz && /opt/node22/bin/node --version

# cadgen (MIT, earthtojake/text-to-cad) in its OWN virtualenv: it installs cadquery-ocp-novtk,
# which would replace the cadquery-ocp wheel CadQuery needs. The worker runs it only as a
# sandboxed subprocess (cad_worker/text_to_cad/runner.py). Pinned: change with bd_names.py.
RUN python -m venv /opt/cadgen \
    && /opt/cadgen/bin/pip install --no-cache-dir "cadgen==0.7.20" \
    && /opt/cadgen/bin/python -I -c "import cadgen, build123d; print('cadgen', cadgen.__version__, 'build123d', build123d.__version__)"

RUN useradd --create-home --uid 10001 cad
WORKDIR /app
COPY pyproject.toml ./
COPY cad_worker ./cad_worker
RUN pip install --no-cache-dir .

USER cad
ENV PORT=8080 CAD_WORKER_TIMEOUT_S=30 CAD_WORKER_CONCURRENCY=2 \
    CADGEN_PYTHON=/opt/cadgen/bin/python CADGEN_NODE=/opt/node22/bin/node \
    CADGEN_TIMEOUT_S=120 TEXT_TO_CAD_CONCURRENCY=1 \
    CADGEN_TELEMETRY=0 DO_NOT_TRACK=1 CADGEN_DAEMON=0 CADGEN_UPDATE_CHECK=0
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz')"
CMD ["python", "-m", "cad_worker.app"]
