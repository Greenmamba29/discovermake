# DiscoverMake

**Discover. Make. Build.**

DiscoverMake is an on-demand manufacturing platform, in the style of SendCutSend. A customer uploads a flat part, gets an instant binding price, pays, and a vetted partner shop makes it. The order is inspected, shipped and tracked to the door. Every delivered part comes with a signed, publicly verifiable Product Passport.

## What R1 ("Cut") does

R1 runs a real order end to end:

1. **Upload a DXF.** It is parsed: units, outer edges and holes, cut length, pierces and bend lines.
2. **DFM checks** run against versioned rules, and the part gets a 0–100 makeability score with one-tap fixes.
3. **Configure** material, thickness, finish, secondary operations and quantity.
4. **Get an instant binding quote.** Prices are integer cents, computed on the server from the shop rate card, with a quantity ladder and a ship date.
5. **Check out.** The server prices the order; the client only sends ids. Payment goes through Stripe Checkout (card, ACH, wallets).
6. **Payment is confirmed** by a signed webhook. The order becomes `PAID`, the ledger split is posted, and the order is dispatched to the best capable partner shop.
7. **The shop works the job in the Shop Console:** accept, record production milestones, then submit a QA inspection with photos.
8. **QA must pass before shipping.** A failed inspection opens a rework job.
9. **Shipping:** an EasyPost label is bought and tracking webhooks update the order.
10. **On delivery,** the Product Passport is activated at `/passport/:id` (with a QR code), the shop payout is recorded in the double-entry ledger, and the order is `COMPLETE`.

Every state change writes a domain event to the outbox in the same database transaction (ADR-0002). Order status changes only through the state machine (ADR-0007).

Stack: Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind, zod, Drizzle and Postgres 16, Stripe, EasyPost, S3-compatible storage, Resend, and bun.

Docs:
- The architecture and module map is `docs/architecture/r1-implementation.md`.
- Specs are in `workflows/` and `docs/product/`.
- Decisions are in `docs/adr/`.

---

## Local setup

**Prerequisites:** bun ≥ 1.1, Postgres 16, and Chromium for e2e (Playwright's own browser or one at `/opt/pw-browsers/chromium`).

```bash
bun install

# 1. Postgres
createuser -s dm && psql -c "alter user dm password 'dm'" && createdb -O dm discovermake
#    (or: docker run -p 5432:5432 -e POSTGRES_USER=dm -e POSTGRES_PASSWORD=dm -e POSTGRES_DB=discovermake postgres:16)

# 2. Environment
cp .env.local.example .env.local
#    For local development set:
#      PAYMENT_PROVIDER=dev   CARRIER=manual   STORAGE_DRIVER=local
#      ADMIN_TOKEN=<anything long>   SEED_SHOP_TOKEN=dmshop_<anything 20+ chars>  (optional, fixed console token)

# 3. Schema + catalog + dev shop
bun run db:migrate
bun run db:seed        # prints the Shop Console token once (or uses SEED_SHOP_TOKEN)

# 4. Run
bun run dev            # http://localhost:3000
```

Try it: upload a DXF on `/`, or use the built-in sample. Configure the part, then check out; the dev payment panel stands in for Stripe. Open the Shop Console at `/shop` with the seeded token, then mark the order delivered from `/admin` with your `ADMIN_TOKEN`.

`PAYMENT_PROVIDER=dev` and `CARRIER=manual` are test doubles. Both refuse to run when `NODE_ENV=production`.

### Tests

| Command | What it checks |
|---|---|
| `bun run typecheck` | `tsc --noEmit` over the whole repo |
| `bun run lint` | ESLint (`next/core-web-vitals`) with zero warnings allowed |
| `bun run test` | Vitest. Each integration suite creates and drops its own throwaway Postgres database, so `DATABASE_URL` must point at a role that can `CREATE DATABASE` |
| `bun run test:e2e` | Playwright against `next dev` on :3100. It drops and recreates `discovermake_e2e`, then migrates and seeds it. It runs `tests/e2e/order.spec.ts`, the release gate: a full real order from DXF upload to verified passport, plus ledger balance and tampered-token checks |
| `bun run build` | Production build |

For e2e, set `E2E_DATABASE_URL` to use another database; its name must end in `_e2e`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to choose a different browser binary.

---

## Running a real production order

### 1. Infrastructure and environment

Set these in your host's encrypted environment, never in git. Every variable is documented in `.env.local.example`.

| Area | Variables |
|---|---|
| App | `NODE_ENV=production`, `APP_URL=https://your-domain` |
| Database | `DATABASE_URL` (Postgres 16: Supabase, Neon, RDS…) |
| Storage | `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT` (R2, Supabase or MinIO; omit for AWS), `S3_FORCE_PATH_STYLE` |
| Payments | `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Shipping | `CARRIER=easypost`, `EASYPOST_API_KEY`, `EASYPOST_WEBHOOK_SECRET` |
| Signing | `ORDER_LINK_SECRET`, `PASSPORT_SIGNING_SECRET`, `JOB_PACKET_SIGNING_SECRET`; plus `STORAGE_SIGNING_SECRET` only if you use local storage |
| Ops | `ADMIN_TOKEN`, `CRON_SECRET`, `OPS_EMAIL` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend) |

Generate each secret independently, for example with `openssl rand -base64 48`. Any missing signing secret makes production requests fail closed.

**S3 bucket setup:**
- Keep the bucket private.
- Allow CORS `PUT` and `GET` from `APP_URL`, because browsers upload DXFs and QA photos straight to presigned URLs.
- Uploads are capped at 25 MB per DXF and 15 MB per photo.

### 2. Database

```bash
DATABASE_URL=... bun run db:migrate
DATABASE_URL=... NODE_ENV=production bun run db:seed     # catalog only: never creates the dev shop in production
```

### 3. Stripe

1. Use live-mode keys. In **Settings → Payment methods**, enable the methods you accept (cards, US bank account/ACH, Apple Pay and Google Pay). Checkout is hosted by Stripe; no card data touches our servers.
2. Add a webhook endpoint at `https://your-domain/api/webhooks/stripe` with these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`

   Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Events are verified, recorded once each, and safe to replay.
3. **Shop payouts:** enable Stripe Connect and give each shop a connected account (`acct_…`). On delivery the payout is sent as a transfer. Shops without a Connect account get a `PENDING` manual payout; settle it with `POST /api/admin/payouts/:payoutId/paid {"reference":"ACH-…"}` or from `/admin`.

### 4. Shipping

- **EasyPost (production):** add a webhook at `https://your-domain/api/webhooks/easypost` with a webhook secret, and set `EASYPOST_WEBHOOK_SECRET` to match. Labels are bought for the shipping method the buyer paid for. Each label is copied into your bucket and handed to the shop only as a short-lived signed link. A tracker update that reaches `delivered` completes the order.
- **Manual (staging only):** the shop types in the carrier and tracking number, and ops confirms delivery with `POST /api/admin/orders/:orderId/delivered`. This carrier refuses to run in production.

### 5. Schedulers

`vercel.json` schedules two jobs. Vercel sends `Authorization: Bearer $CRON_SECRET` with each call. On other hosts, call these routes with the same header:
- `GET /api/admin/offers/expire` every 10 minutes expires unanswered shop offers and re-dispatches the order.
- `GET /api/admin/outbox/publish` every 5 minutes relays outbox events.

### 6. Onboard a real shop

```bash
curl -sS https://your-domain/api/admin/shops \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{
    "name": "Acme Laser Works",
    "contactEmail": "jobs@acmelaser.example",
    "address": { "name": "Acme Laser Works", "line1": "100 Industrial Way", "city": "Camden", "region": "NJ", "postalCode": "08102", "country": "US", "phone": "+18565550100" },
    "timezone": "America/New_York", "queueDays": 2, "acceptWindowMinutes": 120,
    "stripeAccountId": "acct_XXXXXXXXXXXX",
    "rateCard": {
      "fiberLaserCentsPerHour": 15000, "co2LaserCentsPerHour": 9000,
      "brakeCentsPerBend": 250, "brakeSetupCents": 2000, "orderSetupCents": 1500,
      "partHandlingCents": 50, "finishingCentsPerFt2": 350, "finishBatchSetupCents": 3500,
      "qaCentsPerPart": 25, "packagingBaseCents": 400,
      "platformMarginPct": 0.35, "minimumOrderCents": 2900
    },
    "capabilities": [
      { "thicknessOptionId": "thk_al5052_063", "processId": "prc_fiber_laser", "bedWidthMm": 1524, "bedHeightMm": 3048, "machineLabel": "Fiber 4 kW" },
      { "thicknessOptionId": "thk_al5052_063", "processId": "prc_press_brake", "bedWidthMm": 1250, "bedHeightMm": 1250, "maxBendLengthMm": 1250 }
    ],
    "serviceIds": ["svc_bending", "svc_deburr", "svc_powder_black_matte"]
  }'
```

The response contains `consoleToken.token`, which is shown **once**; only its hash is stored. Send it to the shop over a secure channel. They sign in at `https://your-domain/shop`.

To manage tokens:
- Rotate: `POST /api/admin/shops/:shopId/tokens {"label":"…"}`
- Revoke: `DELETE /api/admin/shops/:shopId/tokens/:tokenId`

How routing works:
- Catalog ids (`thk_…`, `prc_…`, `svc_…`) come from `GET /api/catalog`.
- A shop is routed only the jobs it can run: capability for the thickness and process, a bed that fits, a press brake for bent parts, and every finish or secondary operation the buyer selected.

### 7. Ops

| Task | How |
|---|---|
| Order board, dispatch, deliveries, refunds, manual payouts | `/admin`, signed in with `ADMIN_TOKEN` |
| Refund before shipping | `POST /api/admin/orders/:id/refund {"reason":"…"}`. This refunds at the provider, cancels the shop job and reverses the ledger |
| Order detail with full ledger | `GET /api/admin/orders/:id` |

---

## Go-live checklist

- [ ] **Rotate every secret** that was ever used outside production (Stripe, EasyPost, Resend, S3, database), and any credential named in `workflows/11-platform-security-infra.md` → Immediate actions.
- [ ] Set `ADMIN_TOKEN` and `CRON_SECRET`: long, random, and different from each other.
- [ ] Set `PASSPORT_SIGNING_SECRET`, `ORDER_LINK_SECRET` and `JOB_PACKET_SIGNING_SECRET` to independent random values, and keep them stable:
  - Rotating `ORDER_LINK_SECRET` revokes every buyer link.
  - Rotating `PASSPORT_SIGNING_SECRET` makes existing passports fail verification.
- [ ] `NODE_ENV=production`, `PAYMENT_PROVIDER=stripe`, `CARRIER=easypost`, `STORAGE_DRIVER=s3`. The test doubles refuse to start otherwise.
- [ ] **Stripe live mode:** live keys, the live webhook endpoint and its secret, payment methods enabled, Connect enabled, and every shop's `acct_…` set.
- [ ] EasyPost production key, webhook URL and secret, and the shop return addresses verified.
- [ ] Resend domain verified; `EMAIL_FROM` and `OPS_EMAIL` set.
- [ ] Database backups and point-in-time recovery enabled. Ran `db:migrate` and a catalog-only `db:seed`.
- [ ] Schedulers running (`vercel.json`, or the equivalent cron on another host).
- [ ] At least one real shop onboarded with a calibrated rate card. **All seeded coefficients are uncalibrated defaults**, so check them against real shop invoices before quoting publicly. See the open decisions in `docs/architecture/r1-implementation.md` §12.
- [ ] One end-to-end order placed in Stripe test mode on staging, then one small live order refunded through `/api/admin/orders/:id/refund`.
- [ ] **Legal pages: TODO.** Terms of Service, Privacy Policy, refund and returns policy, and a prohibited-items / export-control policy must be written, linked from checkout (the terms checkbox) and from the footer, and reviewed by counsel.
- [ ] Sales tax decision: R1 charges $0 tax.
