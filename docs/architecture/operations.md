# Operations runbook (GA)

## Deploys and the database
Vercel runs `bun run vercel-build` (`scripts/ops/vercel-build.sh`). On a **production** deploy with `DATABASE_URL` set it applies the migrations (`db:migrate`, including the manual immutability trigger) and the idempotent catalog seed (`db:seed --catalog-only`: materials, rate tables, DFM ruleset; never the dev shop), then runs `next build`. Preview deploys never touch the production database. Attaching a database therefore needs only one redeploy. If the project's Build Command is overridden in Vercel settings, set it to `bun run vercel-build`.

## Health and alerting
- `GET /api/health`: 200 `{"status":"ok"}` when Postgres answers within 2 s, else 503 `degraded`. It reports which integrations are configured (booleans only, never values). Point the uptime monitor and load balancer here, at 1-minute intervals; page after 3 consecutive failures.
- Server errors: `src/instrumentation.ts` writes one JSON line per error that Next captures: `event: "server.request_error"`, with path (no query string), method, route, render source and digest. Alert when there are more than 5 per minute for 5 minutes. Use the digest to find the matching client-side error.
- Ops alerts already in the product: ops email and the alerts on the ops board (R1). The Sourcing desk shows a count of pending approvals.

## Error budgets (SLOs)
| Path | SLO | Measured by |
|---|---|---|
| `/api/health` | p95 ≤ 200 ms, 99.9% available | uptime monitor + load test |
| Catalog / pages | p95 ≤ 300 ms | load test |
| Instant quote flow (create → upload → analyze → quote) | p95 ≤ 3 s, ≤ 1% errors | load test |
| Order webhooks | every Stripe event processed once (idempotent) | `webhook_events` table |

## Load tests
`bun scripts/load/run.ts --base <url> --duration 30 --concurrency 20 [--scenario health,catalog,quote] [--spoof-ip]`

The script exits 1 when a scenario misses its SLO. Only use `--spoof-ip` against your own staging or local servers; without it, per-IP rate limits throttle the run, and those 429s are reported separately from errors.

Baseline (2026-10-10, local production build of the full app, 20 virtual users, single node, local Postgres; the script keeps one cookie jar per virtual user, as a browser does, because parts belong to the `dm_device` cookie):

| Scenario | Requests/s | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| health | 923 | 21 ms | 32 ms | 42 ms | 0 |
| catalog | 226 | 84 ms | 118 ms | 144 ms | 0 |
| quote (full flow) | 21.0 | 932 ms | 1109 ms | 1187 ms | 0 |

## Backups and restore drills
- Production Postgres: use the provider's point-in-time recovery (Neon/Supabase), with retention ≥ 7 days.
- Run the drill **monthly** and after every schema migration:
  `SOURCE_URL=<read-only replica or snapshot URL> scripts/ops/restore-drill.sh`
  It dumps the database, restores it into a scratch `*_drill` database, and compares exact row counts for every table. Record the duration and the result in the ops log.
  - Last run (2026-10-10, local, 100 tables, restored in 2 s): PASS.
- Object storage (designs, CAD artifacts, labels): enable bucket versioning and a lifecycle rule. Losing a design file breaks its Product Passport links.

## On-call
1. **Check `/api/health`.** If the database is down, look at the provider status page and connection limits (postgres-js uses a pool of 10 per instance).
2. **Payment issues.**
   - Check the Stripe dashboard → Events, then the `webhook_events` rows.
   - Replays are safe because event processing is idempotent.
3. **Stuck orders.**
   - On the ops board (`/admin`), look for orders without a shop or whose offers expired.
   - The offer-expiry cron runs daily; `POST /api/admin/offers/expire` runs it on demand with `ADMIN_TOKEN`.
4. **Outbox backlog:** `POST /api/admin/outbox/publish`.
5. **Sourcing.** Expired leases return to the queue automatically. Revoking an Accio client releases its leases.
6. **Secrets rotation.**
   - Rotating `ORDER_LINK_SECRET` revokes every order link. Re-send links from ops.
   - Rotate `ADMIN_TOKEN`, `CRON_SECRET` and the Stripe keys every quarter, and immediately after any exposure.

## Security headers
`next.config.js` sets CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy (camera and microphone same-origin only, for capture and going live) and COOP on every route. `tests/ga/health-and-headers.test.ts` pins them.

## Upload security
- Every upload is scanned by ClamAV before anything parses it (`src/server/security/upload-scan.ts`, clamd INSTREAM over TCP). That covers DXF parts (direct upload and signed-URL uploads at analyze time) and workspace attachments (images, CAD, Reconstruct photos).
- Production settings: run `clamd` (for example the `clamav/clamav` container) next to the app, then set `CLAMAV_HOST`, `CLAMAV_PORT` and `UPLOAD_SCAN_REQUIRED=true`.
  - With those set, scanning **fails closed**: if clamd is unreachable, uploads answer 503.
  - An infected file answers 422 and is deleted from storage.
- Parsers stay defensive regardless:
  - The DXF parser has hard work budgets (entity visits, INSERT depth and array size, cut-edge and spline caps).
  - Uploads are size-capped and format-sniffed.
  - Attachments are checked by magic bytes.
