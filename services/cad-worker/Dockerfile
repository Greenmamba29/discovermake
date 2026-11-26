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

# SolidCraft (MIT OR Apache-2.0, tangency-labs/solidcraft): parametric CAD engine for model scripts
# that are data, not code (cad_worker/solidcraft). Only the headless solidcraft-cli is kept: the
# desktop app and its brand-licensed interface are not shipped. The checksum is the release's
# SHA256SUMS.txt entry; change both with cad_worker/solidcraft/commands.py.
ARG SOLIDCRAFT_VERSION=0.48.1
ARG SOLIDCRAFT_SHA256_AMD64=0781bd71de0a67a4bf98ad9e2cc8aa5248d3b6e7db2b7f1dfae7f426555d8b67
ARG SOLIDCRAFT_SHA256_ARM64=491a4d405800c7e3e7b1bb2c030c3ebf2fd26069aed532cefa41a904be231cdf
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) a=x86_64; sum="$SOLIDCRAFT_SHA256_AMD64" ;; arm64) a=aarch64; sum="$SOLIDCRAFT_SHA256_ARM64" ;; *) echo "unsupported arch $arch" && exit 1 ;; esac \
    && f="solidcraft-${SOLIDCRAFT_VERSION}-linux-${a}.tar.gz" \
    && curl -fsSL "https://github.com/tangency-labs/solidcraft/releases/download/v${SOLIDCRAFT_VERSION}/${f}" -o "/tmp/${f}" \
    && echo "${sum}  /tmp/${f}" | sha256sum -c - \
    && mkdir -p /opt/solidcraft/bin /opt/solidcraft/share \
    && tar -xzf "/tmp/${f}" -C /tmp \
    && mv "/tmp/solidcraft-${SOLIDCRAFT_VERSION}-linux-${a}/bin/solidcraft-cli" /opt/solidcraft/bin/ \
    && cp -r "/tmp/solidcraft-${SOLIDCRAFT_VERSION}-linux-${a}/share/doc" /opt/solidcraft/share/ 2>/dev/null || true \
    && rm -rf /tmp/solidcraft-* \
    && SOLIDCRAFT_NO_TELEMETRY=1 DO_NOT_TRACK=1 SOLIDCRAFT_UPDATE_CHECK=0 /opt/solidcraft/bin/solidcraft-cli --version

RUN useradd --create-home --uid 10001 cad
WORKDIR /app
COPY pyproject.toml ./
COPY cad_worker ./cad_worker
RUN pip install --no-cache-dir .

USER cad
ENV PORT=8080 CAD_WORKER_TIMEOUT_S=30 CAD_WORKER_CONCURRENCY=2 \
    CADGEN_PYTHON=/opt/cadgen/bin/python CADGEN_NODE=/opt/node22/bin/node \
    CADGEN_TIMEOUT_S=120 TEXT_TO_CAD_CONCURRENCY=1 \
    CADGEN_TELEMETRY=0 DO_NOT_TRACK=1 CADGEN_DAEMON=0 CADGEN_UPDATE_CHECK=0 \
    SOLIDCRAFT_CLI=/opt/solidcraft/bin/solidcraft-cli SOLIDCRAFT_TIMEOUT_S=90 \
    SOLIDCRAFT_NO_TELEMETRY=1 SOLIDCRAFT_UPDATE_CHECK=0
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz')"
CMD ["python", "-m", "cad_worker.app"]
