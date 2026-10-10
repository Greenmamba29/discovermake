#!/usr/bin/env bash
# Vercel build: on production deploys with a database attached, apply migrations and the
# idempotent catalog seed (catalog only: no dev shop in production), then build the app.
# Preview deploys never touch the production database.
set -euo pipefail

if [[ "${VERCEL_ENV:-}" == "production" && -n "${DATABASE_URL:-}" ]]; then
    echo "[vercel-build] production deploy: applying migrations"
    bun run db:migrate
    echo "[vercel-build] seeding the catalog (idempotent, catalog only)"
    NODE_ENV=production bun run db:seed -- --catalog-only
elif [[ "${VERCEL_ENV:-}" == "production" ]]; then
    echo "[vercel-build] DATABASE_URL is not set: skipping migrations (the app will report degraded health)" >&2
fi

exec bunx next build
