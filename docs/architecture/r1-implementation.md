# R1 "Cut" implementation guide

**Goal:** a real customer runs an actual order end to end:

1. Upload a DXF, then parse it, run DFM checks and configure it.
2. Get an instant **binding** quote and check out with server-side pricing.
3. Payment is confirmed and the order is dispatched to a partner shop.
4. The shop accepts in the Shop Console and records milestones.
5. QA must pass before a shipment with tracking can be created.
6. The order is delivered, the **Product Passport** is activated, and payouts are recorded in the ledger.

The specs are workflows 02, 04, 05, 09, 10 and 11, ADR-0001…0008, and spec §12, 13, 18, 19, 23, 28 and 29. The Make.com template marketplace was removed by owner decision; its specs are archived in `docs/archive/`.

> **Status (2026-10-06): integrated.** The four parallel builds (quote, orders, shop, ui) are merged and wired. A real order runs end to end, proven by `tests/e2e/order.spec.ts` (fresh seeded DB, real UI and APIs, only the env-flagged doubles). §11 lists what changed during integration and §12 the decisions still owed by the owner. Setup and go-live steps live in the root `README.md`.

> Next.js here is **16.x** (App Router, React 19). Route handler `params` is a `Promise`. Middleware is now `proxy.ts`. Read `node_modules/next/dist/docs/` before using an unfamiliar API.

---

## 1. Module map

```
src/
  contracts/            zod schemas + inferred types: THE single source of truth (client-safe, no server imports)
    enums.ts            every enum (DB pgEnums derive from these arrays)
    common.ts           ids, Cents, Address, Actor, SignedUpload, ApiErrorBody
    catalog.ts parts.ts quotes.ts checkout.ts orders.ts shop.ts shipments.ts passport.ts admin.ts events.ts
  server/
    env.ts              typed lazy env(), assertNotProduction(), requireSecret()
    ids.ts              newId(kind), newBuildDisplayId(), newOrderNumber(), uuidv7()
    http.ts             route() wrapper, json(), parseJson(), parseQuery(), ApiError
    auth/               tokens.ts (sha256/HMAC/canonicalJson/safeEqual), order-link.ts, admin.ts
    db/                 schema.ts, index.ts (getDb/setDb/withTx), migrate.ts, seed.ts, test-db.ts
    events/outbox.ts    emitEvent(tx, …), publishPendingEvents(), subscribe()
    storage/            Storage interface, LocalDiskStorage, S3Storage, getStorage()
    orders/             state.ts (pure machine) + advance.ts (advanceOrder, implemented) + index.ts   [orders]
    payments/           PaymentProvider (stripe | dev)                                               [orders]
    ledger/             double-entry postings + payouts                                              [orders]
    notify/             notify(kind, payload): console | Resend                                      [orders]
    quote/              upload, DXF analysis, DFM, catalog, pricing, quotes                          [quote]
    dispatch/           shop matching + job offers                                                   [shop]
    shops/              console auth, jobs, milestones, QA, shipment creation                        [shop]
    shipping/           CarrierAdapter (easypost | manual), tracking, delivery orchestration         [shop]
    passport/           signed passports, public view, verify                                        [shop]
  app/                  pages [ui] + api routes [per owner below]
database/migrations/    drizzle-kit generated SQL (never hand-edit; `bun run db:generate`)
tests/                  foundation/ quote/ orders/ shop/ e2e/ support/
```

### Foundation pieces that are already fully implemented (do not fork)
- `src/server/orders/state.ts` and `advanceOrder()` (`src/server/orders/advance.ts`). This is the only writer of `orders.status`.
- `emitEvent` / `publishPendingEvents` (outbox), `getDb` / `setDb` / `withTx`, `createTestDb`, `seed`.
- Storage drivers and `/api/storage/local/[...key]` (local signed GET/PUT).
- Auth primitives: `generateToken`, `sha256Hex`, `hmacHex`, `safeEqual`, `canonicalJson`, `bearerToken`. Order links: `createOrderAccessToken`, `hashOrderAccessToken`, `verifyOrderAccessToken`, `buildOrderUrl`, `readOrderToken`. `requireAdmin`.
- `route()` / `ApiError` error mapping. `IllegalTransitionError` maps to 409 and `OrderNotFoundError` to 404.

## 2. File ownership (parallel agents)

> Historical: this split governed the parallel build. After integration any change may touch any module, but cross-module calls still go through each module's `index.ts`.

The agents work in parallel on disjoint paths. **Never edit a path you don't own.** If you need a change elsewhere, write it down in your result's `open_issues`.

| Agent | Owns |
|---|---|
| **quote** | `src/server/quote/**`, `src/app/api/catalog/**`, `src/app/api/parts/**`, `src/app/api/builds/**`, `src/app/api/quotes/**`, `tests/quote/**` |
| **orders** | `src/server/orders/**` (keep `state.ts` + `advanceOrder` semantics), `src/server/payments/**`, `src/server/ledger/**`, `src/server/notify/**`, `src/app/api/checkout/**`, `src/app/api/orders/**`, `src/app/api/webhooks/stripe/**`, `src/app/api/webhooks/dev-payment/**`, `tests/orders/**` |
| **shop** | `src/server/dispatch/**`, `src/server/shops/**`, `src/server/shipping/**`, `src/server/passport/**`, `src/app/api/shop/**`, `src/app/api/passport/**`, `src/app/api/admin/**`, `src/app/api/webhooks/easypost/**`, `tests/shop/**` |
| **ui** | everything under `src/app/**` **except** `src/app/api/**`; `src/components/**`; `src/lib/**` (client utilities); `tests/e2e/**` |
| **foundation (frozen)** | `src/contracts/**`, `src/server/{db,events,storage,auth}/**`, `src/server/{env,ids,http}.ts`, `src/app/api/storage/**`, `database/**`, `package.json`, configs, `tests/foundation/**`, `tests/support/**` |

Frozen means no new dependencies and no edits to contracts or schema without an orchestrator round. If a contract really must change, report it in `open_issues` with the exact diff.

Cross-module calls go **only** through the exported functions in each module's `index.ts` (signatures below). Reading another module's tables directly is allowed (for example, orders reads `quotes`, shop reads `orders`). Writing them is not, except through the owner's functions and `advanceOrder`.

## 3. Conventions every agent follows

- **Server-side pricing only.** Clients send ids. Every amount comes from a quote snapshot or a rate card. Money is integer cents plus `currency` (`usd`).
- **DB access:** call `getDb()` at call time. Functions that join a caller's transaction take `tx?: DbOrTx` and use `withTx(fn, tx)`.
- **Events:** every meaningful state change calls `emitEvent(tx, { type, payload, actor, correlationId, buildId, orderId, causationId })` in the **same transaction**. For order-scoped events use `orders.correlation_id` and set `orderId`. Payload schemas live in `src/contracts/events.ts`.
- **Order status** changes only via `advanceOrder(orderId, to, actor, meta?, tx?)`.
- **Side effects after commit** (emails, offers to the next shop, provider API calls). Every handler is idempotent.
- **Validation:** every route parses input with zod from `@/contracts` (`parseJson`, `parseQuery`). Every response conforms to its contract type.
- **Errors:** `throw new ApiError(code, message)`, wrap handlers in `route()`. Error body is `{ error: { code, message, details? } }`.
- **Test doubles** (`PAYMENT_PROVIDER=dev`, `CARRIER=manual`) call `assertNotProduction(...)` and refuse when `NODE_ENV=production`.
- **Secrets** come from `env()` / `requireSecret()`. Add any new env var to `.env.local.example`, `src/server/env.ts` and the table below. That is a foundation change, so report it.
- **Universal status language** for UI pills: `DRAFT · ANALYZING · NEEDS_INPUT · READY · REVIEW · IN_PRODUCTION · LIVE · COMPLETE · FAILED · CANCELLED`. Views expose `universalStatus`. Order mapping is `ORDER_UNIVERSAL_STATUS`.
- **Route handlers:** `export const runtime = 'nodejs'` for anything touching Postgres or crypto. Use `export const dynamic = 'force-dynamic'` where responses vary.
- **Tests:** vitest. Integration suites call `useTestDb({ seed: true })` (`tests/support/db.ts`), which creates a unique throwaway database, so suites run in parallel. Seeded ids are listed in §8.

## 4. API routes (complete R1 list)

The auth column uses these values:
- **public:** no credentials, but ids are unguessable 100-bit values.
- **order-token:** `x-order-token` header or `?t=`.
- **shop-session:** httpOnly `dm_shop_session` cookie.
- **admin:** `Authorization: Bearer ADMIN_TOKEN`.
- **signature:** provider signature verification.

| Method | Path | Request contract | Response contract | Auth | Owner |
|---|---|---|---|---|---|
| GET | `/api/catalog` | – | `CatalogResponse` | public | quote |
| POST | `/api/parts` | `CreatePartRequest` | `CreatePartResponse` (201) | public | quote |
| POST, PUT | `/api/parts/:partId/upload` | multipart `file` field or raw DXF body | `PartView` | public | quote (direct-upload alternative to the signed PUT; 415 on bad content, 409 once the design is in an order) |
| PUT | `upload.url` (S3 presigned or `/api/storage/local/<key>?…`) | raw DXF bytes, headers from `upload.headers` | 200 empty | signed URL | foundation |
| GET | `/api/parts/:partId` | – | `PartView` | public | quote |
| POST | `/api/parts/:partId/analyze` | `AnalyzePartRequest` | `PartView` | public | quote |
| GET | `/api/builds/:buildId` | – | `BuildView` | public | quote |
| POST | `/api/quotes` | `CreateQuoteRequest` | `QuoteView` (201) | public | quote |
| GET | `/api/quotes/:quoteId` | – | `QuoteView` | public | quote |
| POST | `/api/checkout` | `CheckoutRequest` | `CheckoutResponse` (201) | public | orders |
| GET | `/api/orders/:orderId` | – | `OrderView` | order-token | orders |
| POST | `/api/webhooks/stripe` | raw Stripe event | `{ received: true }` | signature (`STRIPE_WEBHOOK_SECRET`) | orders |
| POST | `/api/webhooks/dev-payment` | `DevPaymentConfirmRequest` | `DevPaymentConfirmResponse` | dev only (`PAYMENT_PROVIDER=dev`, non-production) | orders |
| POST | `/api/checkout/dev-confirm` | `DevPaymentConfirmRequest` | `DevPaymentConfirmResponse` | dev only | orders (alias of `/api/webhooks/dev-payment`, used by the UI) |
| POST | `/api/shop/session` | `ShopLoginRequest` | `ShopSessionResponse` + Set-Cookie | console token | shop |
| GET | `/api/shop/session` | – | `ShopSessionResponse` (incl. `shippingMode`) | shop-session | shop |
| DELETE | `/api/shop/session` | – | `OkResponse` | shop-session | shop |
| GET | `/api/shop/jobs?status=A,B` | query | `ShopJobListResponse` | shop-session | shop |
| GET | `/api/shop/jobs/:jobId` | – | `ShopJobDetail` | shop-session | shop |
| POST | `/api/shop/jobs/:jobId/accept` | – | `ShopJobDetail` | shop-session | shop |
| POST | `/api/shop/jobs/:jobId/decline` | `DeclineJobRequest` | `ShopJobDetail` | shop-session | shop |
| POST | `/api/shop/jobs/:jobId/milestones` | `MilestoneRequest` | `MilestoneView` (201) | shop-session | shop |
| POST | `/api/shop/jobs/:jobId/uploads` | `QaUploadRequest` | `QaUploadResponse` (201) | shop-session | shop |
| POST | `/api/shop/jobs/:jobId/inspection` | `InspectionSubmitRequest` | `InspectionResultView` (201) | shop-session | shop |
| POST | `/api/shop/jobs/:jobId/shipment` | `CreateShipmentRequest` | `ShipmentView` (201) | shop-session | shop |
| GET | `/api/passport/:passportId` | – | `PassportPublicResponse` (view + `qrCodeDataUrl`) | public | shop |
| GET | `/api/passport/:passportId/verify` | – | `PassportVerifyResponse` | public | shop |
| GET | `/api/admin/orders?status=A,B` | query | `AdminOrderListResponse` | admin | shop |
| GET | `/api/admin/orders/:orderId` | – | `AdminOrderDetail` | admin | shop |
| POST | `/api/admin/orders/:orderId/dispatch` | – | `AdminDispatchResponse` | admin | shop |
| POST | `/api/admin/orders/:orderId/delivered` | `MarkDeliveredRequest` | `ShipmentView` | admin | shop (marks the order's latest shipment) |
| POST | `/api/admin/orders/:orderId/refund` | `AdminRefundRequest` | `AdminOrderDetail` | admin | integration |
| POST | `/api/admin/shipments/:shipmentId/delivered` | `MarkDeliveredRequest` | `ShipmentView` | admin | shop |
| POST | `/api/admin/payouts/:payoutId/paid` | `MarkPayoutPaidRequest` | `AdminPayoutView` | admin | integration |
| POST, GET | `/api/admin/offers/expire` | – | `ExpireOffersResponse` | admin or cron (`CRON_SECRET`) | shop |
| POST, GET | `/api/admin/outbox/publish` | – | `PublishOutboxResponse` | admin or cron (`CRON_SECRET`) | integration |
| POST | `/api/admin/shops` | `CreateShopRequest` | `CreateShopResponse` (201, console token shown once) | admin | shop |
| POST | `/api/admin/shops/:shopId/tokens` | `IssueShopTokenRequest` | `ShopConsoleTokenView` (201) | admin | shop |
| DELETE | `/api/admin/shops/:shopId/tokens/:tokenId` | – | `OkResponse` | admin | shop |
| POST | `/api/shop/payouts/connect` | – (optional `{}`) | `ShopConnectLinkResponse` (Stripe Connect onboarding link; creates the Express account once) | shop-session | shop (503 without `STRIPE_SECRET_KEY`) |
| GET | `/api/shop/payouts/status` | – | `ShopPayoutStatusResponse` (live from Stripe) | shop-session | shop (503 without `STRIPE_SECRET_KEY`) |
| POST | `/api/admin/shops/:shopId/connect` | – | `AdminShopConnectLinkResponse` | admin | shop (ops-assisted onboarding) |
| POST | `/api/webhooks/stripe-connect` | raw Stripe Connect event | `{ received: true }` | signature (`STRIPE_CONNECT_WEBHOOK_SECRET`) | shop (`account.updated` -> `shop.connect_account_updated`) |
| POST | `/api/webhooks/easypost` | raw EasyPost event | `{ received: true }` | signature (`EASYPOST_WEBHOOK_SECRET`) | shop |
| POST | `/api/shop/carrier-webhook` | raw EasyPost event | `{ received: true }` | signature | shop (alias of `/api/webhooks/easypost`) |
| GET, PUT | `/api/storage/local/[...key]` | signed query | bytes / 200 | signed URL (local driver only) | foundation |

### UI pages (as built)

Route groups: `(marketing)` for `/`, `(app)` for the buyer flow, `(console)` for `/shop*` and `/admin`.

| Path | Screen | Data |
|---|---|---|
| `/` | Home: "What do you want to make?" + DXF drop zone | `POST /api/parts`, then PUT to `upload.url`, then `POST /api/parts/:id/analyze`, then `/parts/:id` |
| `/make` | Upload flow (+ "Try a sample mounting plate") | same as `/` |
| `/parts/[partId]` | 01 Configure + 02 Instant Quote on one screen (3D preview, DoorDash option groups, units prompt, DFM fixes incl. `ADD_SERVICE`/`REMOVE_SERVICE`, ladder, ⓘ breakdown) | `GET /api/parts/:id`, `GET /api/catalog`, `POST /api/quotes` |
| `/checkout/[quoteId]` | 04 Approve + Checkout (address, shipping options from the quote, terms) | `POST /api/checkout`, then `payment.redirectUrl` (Stripe) or the dev panel |
| `/build/[buildId]/configure`, `/quote?quote=`, `/route?quote=`, `/approve?quote=` | Spec routes; forward to the pages above. `approve` is Stripe's `cancel_url` | – |
| `/orders` | Paste an order link / reopen orders placed in this browser | – |
| `/checkout/dev-pay?ref=` | Dev payment page (only when `PAYMENT_PROVIDER=dev`) | `POST /api/webhooks/dev-payment`, then `redirectUrl` |
| `/orders/[orderId]?t=` | 06 Order Tracking (stepper, timeline, shop card, shipment, passport preview), polls every 3 s | `GET /api/orders/:id` |
| `/orders/[orderId]/production?t=` | 05 Production Run | `GET /api/orders/:id` |
| `/passport/[passportId]` | Public verify page plus QR code (`qrcode`) of `verifyUrl` | `GET /api/passport/:id` |
| `/shop`, `/shop/jobs`, `/shop/jobs/[jobId]` | Shop Console (login, inbox, packet, milestone buttons, QA form plus photo upload, ship) | `/api/shop/*` |
| `/admin` (optional) | Ops board (admin token kept in sessionStorage) | `/api/admin/*` |

## 5. Module signatures (FINAL)

```ts
// src/server/quote/index.ts                                        [quote]
createPartUpload(input: CreatePartRequest): Promise<CreatePartResponse>
analyzePart(partId: string, input?: AnalyzePartRequest): Promise<PartView>
getPart(partId: string): Promise<PartView | null>
getBuild(buildId: string): Promise<BuildView | null>
getCatalog(): Promise<CatalogResponse>
createQuote(input: CreateQuoteRequest): Promise<QuoteView>
getQuote(id: string): Promise<QuoteView | null>
markQuoteOrdered(quoteId: string, tx?: DbOrTx): Promise<void>

// src/server/orders/index.ts                                       [orders]
createCheckout(input: CheckoutRequest): Promise<CheckoutResponse>
handlePaymentSucceeded(input: PaymentSucceededInput): Promise<{ orderId: string; alreadyProcessed: boolean }>
  // PaymentSucceededInput = { provider, providerRef, providerPaymentId: string|null, amountCents, currency, eventId }
handlePaymentFailed(input: PaymentFailedInput): Promise<{ orderId: string }>
  // PaymentFailedInput = { provider, providerRef, reason: string|null, eventId }
getOrderForBuyer(orderId: string, token: string | null): Promise<OrderView | null>
refundOrder(orderId: string, actor: Actor, reason: string): Promise<void>
advanceOrder(orderId: string, to: OrderStatus, actor: Actor, meta?: AdvanceMeta, tx?: DbOrTx): Promise<OrderRow>   // IMPLEMENTED
  // AdvanceMeta = { reason?, causationId?, shopId?, data?, at? }
// re-exported from ./state: ORDER_TRANSITIONS, assertTransition, canTransition, IllegalTransitionError,
//   isTerminal, ORDER_UNIVERSAL_STATUS, toUniversalStatus, ORDER_STATUS_DISPLAY

// src/server/payments/index.ts                                     [orders]
interface PaymentProvider {
  readonly name: 'stripe' | 'dev'
  createPayment(input: CreatePaymentInput): Promise<{ providerRef: string; redirectUrl: string }>
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent>
  refund(input: { providerRef; providerPaymentId: string|null; amountCents; reason? }): Promise<{ refundRef: string }>
}
getPaymentProvider(): PaymentProvider

// src/server/ledger/index.ts                                       [orders]
recordPaymentSplit(orderId: string, tx?: DbOrTx): Promise<void>
recordPayouts(orderId: string, tx?: DbOrTx): Promise<PayoutRow[]>
recordRefund(orderId: string, amountCents: number, tx?: DbOrTx): Promise<void>

// src/server/notify/index.ts                                       [orders]
notify<K extends NotifyKind>(kind: K, payload: NotifyPayloads[K]): Promise<NotifyResult>   // never rejects
  // kinds: order.confirmed, order.payment_failed, shop.job_offered, order.in_production, order.shipped, order.delivered, ops.alert

// src/server/dispatch/index.ts                                     [shop]
dispatchOrder(orderId: string, opts?: { excludeShopIds?: string[] }, tx?: DbOrTx): Promise<DispatchResult | null>
  // DispatchResult = { jobId, shopId, offerExpiresAt: Date }
expireStaleOffers(now?: Date): Promise<number>

// src/server/shops/index.ts                                        [shop]
authenticateShop(token: string): Promise<(ShopPrincipal & { tokenId: string }) | null>
createShopSession(token: string): Promise<{ sessionSecret: string; shop: ShopPrincipal; expiresAt: Date } | null>
getShopSession(sessionSecret: string | null | undefined): Promise<ShopPrincipal | null>
revokeShopSession(sessionSecret: string): Promise<void>
listJobs(shopId: string, filter?: { status?: JobStatus[] }): Promise<ShopJobSummary[]>
getJob(shopId: string, jobId: string): Promise<ShopJobDetail | null>
acceptJob(shopId: string, jobId: string): Promise<ShopJobDetail>
declineJob(shopId: string, jobId: string, input: DeclineJobRequest): Promise<ShopJobDetail>
recordMilestone(shopId: string, jobId: string, input: MilestoneRequest): Promise<MilestoneView>
createQaUpload(shopId: string, jobId: string, input: QaUploadRequest): Promise<QaUploadResponse>
submitInspection(shopId: string, jobId: string, input: InspectionSubmitRequest): Promise<InspectionResultView>
createShipment(shopId: string, jobId: string, input: CreateShipmentRequest): Promise<ShipmentView>
SHOP_SESSION_TTL_SECONDS = 43200

// src/server/shipping/index.ts                                     [shop]
interface CarrierAdapter {
  readonly name: 'easypost' | 'manual'
  buyLabel(input: BuyLabelInput): Promise<BuyLabelResult>
  parseTrackingWebhook(rawBody: string, headers: Headers): Promise<TrackingUpdate | null>
}
getCarrier(): CarrierAdapter
applyTrackingUpdate(update: TrackingUpdate): Promise<void>
markShipmentDelivered(shipmentId: string, actor: Actor, deliveredAt?: Date): Promise<ShipmentView>

// src/server/passport/index.ts                                     [shop]
activatePassport(orderId: string, tx?: DbOrTx): Promise<{ passportId: string }>
getPublicPassport(id: string): Promise<PassportPublicView | null>
verifyPassport(id: string): Promise<PassportVerifyResponse | null>

// foundation (implemented)
emitEvent<T extends EventType>(tx: DbOrTx, input: EmitEventInput<T>): Promise<DomainEventEnvelope<T>>
publishPendingEvents(opts?: { limit?; db?; handlers? }): Promise<{ published: number; failed: number }>
getDb(): Db · setDb(db | null) · withTx(fn, tx?) · createTestDb({ seed? }): Promise<{ db, url, name, seeded, drop }>
getStorage(): Storage   // putObject, getObject, headObject, deleteObject, getSignedUrl({ method: 'GET'|'PUT', ... })
```

## 6. End-to-end orchestration (who calls whom)

```
UI  POST /api/parts ─► quote.createPartUpload ─► (build.created)
UI  PUT upload.url (bytes)
UI  POST /api/parts/:id/analyze ─► quote.analyzePart ─► (part.uploaded, part.analyzed, dfm.completed)
UI  POST /api/quotes ─► quote.createQuote ─► (dfm.completed, quote.created)        status READY + BINDING
UI  POST /api/checkout ─► orders.createCheckout ─► order PENDING_PAYMENT + payment PENDING (order.created)
       └─► payments.createPayment ─► redirectUrl (Stripe Checkout | /checkout/dev-pay)
Stripe/dev webhook ─► webhook_events dedupe ─► orders.handlePaymentSucceeded
       tx: payment SUCCEEDED · advanceOrder(PAID) · (payment.completed, production.authorized)
           · quote.markQuoteOrdered · ledger.recordPaymentSplit (ledger.payment_recorded)
       after commit: dispatch.dispatchOrder ─► job OFFERED · inspection plan · advanceOrder(DISPATCHED) · (job.offered)
                     notify(order.confirmed) · notify(shop.job_offered)
Shop  accept     ─► shops.acceptJob      ─► advanceOrder(ACCEPTED, shopId) · (job.accepted)
Shop  milestone  ─► shops.recordMilestone ─► first: advanceOrder(IN_PRODUCTION) (production.started); (production.milestone)
Shop  inspection ─► shops.submitInspection
       PASS ─► advanceOrder(QA_PASSED) · (inspection.passed, production.completed)
       FAIL ─► advanceOrder(QA_FAILED) · job QA_FAILED · new rework job ACCEPTED · (inspection.failed)
              next milestone on rework job ─► advanceOrder(IN_PRODUCTION)
Shop  ship       ─► shops.createShipment (requires QA_PASSED) ─► carrier.buyLabel · advanceOrder(SHIPPED) · (shipment.created)
       after commit: easypost label copied to storage (labels/<shipmentId>.<ext>), served only as 15-min signed URLs
Carrier webhook / admin delivered ─► shipping.markShipmentDelivered
       ─► advanceOrder(DELIVERED) (product.delivered) ─► passport.activatePassport (passport.activated)
       ─► ledger.recordPayouts (payout.created) ─► advanceOrder(COMPLETE) (order.completed)   [tx 2]
       after commit: ledger.executePendingPayouts (Stripe Connect transfer; manual payouts stay PENDING) · notify(order.delivered)
Decline / offer expiry ─► (job.declined | job.expired) · advanceOrder(PAID) · after commit dispatchOrder(excludeShopIds)
       no candidates ─► stays PAID, (dispatch.unmatched) + notify(ops.alert); ops dispatch again or refund
Refund (POST /api/admin/orders/:id/refund) ─► provider refund ─► tx: payment REFUNDED · advanceOrder(REFUNDED) (order.refunded)
       · dispatch.cancelOpenJobs (job.cancelled) · ledger.recordRefund
Cron (vercel.json) ─► /api/admin/offers/expire every 10 min · /api/admin/outbox/publish every 5 min
```

### Ledger postings (`ledger_entries`, balanced per `txn_key`)

| txn_key | Lines |
|---|---|
| `payment:<orderId>` | DEBIT `CASH` total · CREDIT `SHOP_PAYABLE` shop_cost · CREDIT `PLATFORM_REVENUE` platform_fee · CREDIT `SHIPPING_PAYABLE` shipping · CREDIT `TAX_PAYABLE` tax (zero lines omitted) |
| `payout:<orderId>:<shopId>` | DEBIT `SHOP_PAYABLE` · CREDIT `PAYOUTS_IN_TRANSIT` (+ `payouts` row PENDING) |
| `refund:<orderId>` | reversal of the payment posting via `REFUNDS` / `CASH` |

The shop payout is `orders.shop_cost_cents`, which is the subtotal minus the platform fee (workflow 05, acceptance 3).

## 7. Data model summary

The tables and ids are:

| Table | Id prefix | Notes |
|---|---|---|
| `builds` | `bld_` | Display id `DM-XXXXX` |
| `parts` | `prt_` | `features` / `dfm` / `preview` jsonb use the contract types |
| `materials` | `mat_` | |
| `thickness_options` | `thk_` | Feed rate, pierce time, kerf, K-factor, sheet price |
| `processes` | `prc_` | |
| `services` | `svc_` | Secondary ops + finishes |
| `dfm_rulesets` | version string | |
| `shops` | `shop_` | |
| `shop_capabilities` | `cap_` | |
| `shop_services` | `ssv_` | Finishes + secondary ops a shop performs; routing and dispatch require every selected service (migration 0001) |
| `shop_rate_cards` | `rc_` | One active per shop |
| `shop_access_tokens` | `stk_` | sha256 only |
| `shop_sessions` | `sss_` | |
| `quotes` | `qte_` | Immutable. DB check: `shop_cost + platform_fee = subtotal` |
| `orders` | `ord_` | Order number `DMO-XXXXXX`. DB check: `total = subtotal + shipping + tax` |
| `order_status_history` | `osh_` | |
| `payments` | `pay_` | Unique `(provider, provider_ref)` |
| `manufacturing_jobs` | `job_` | `source_file_key` / `source_file_sha256` snapshot the quoted file at dispatch (migration 0001) |
| `production_milestones` | `mst_` | |
| `inspection_plans` | `ipl_` | One per job |
| `inspection_results` | `irs_` | |
| `shipments` | `shp_` | |
| `passports` | `pps_` | One per order |
| `ledger_entries` | `led_` | |
| `payouts` | `pout_` | Unique `(order, shop)` |
| `domain_events` | uuid v7 | Outbox |
| `webhook_events` | `whk_` | Unique `(provider, event_id)` |

Schema: `src/server/db/schema.ts`. Migrations: `database/migrations`, generated by `bun run db:generate` and applied by `bun run db:migrate`.

## 8. Seed (dev catalog: ALL coefficients are uncalibrated defaults)

`bun run db:seed` is idempotent. It seeds:

- **3 processes:**
  - `prc_fiber_laser`
  - `prc_co2_laser`
  - `prc_press_brake`
- **8 materials:**
  - `mat_al_5052`
  - `mat_al_6061`
  - `mat_steel_crs`
  - `mat_ss_304`
  - `mat_brass_260`
  - `mat_acrylic_black`
  - `mat_birch_ply`
  - `mat_walnut`
- **34 thickness options.** Ids look like `thk_al5052_063` (0.063" 5052) or `thk_crs_16ga`.
- **12 services:**
  - `svc_bending`
  - `svc_tapping`
  - `svc_countersink`
  - `svc_pem`
  - `svc_deburr`
  - 5 powder coat colors (`svc_powder_*`)
  - 2 Type II anodize finishes (`svc_anodize_clear`, `svc_anodize_black`)
- **DFM rule set** `dfm-2026.10-r1`.
- **Partner shop** `shop_philadelphia_precision`, "Philadelphia Precision Works", Philadelphia, PA. It has 50 capabilities, all 12 services (`ssv_ppw_*`) and rate card `rc_philadelphia_precision_v1`:
  - fiber laser $150/h, CO₂ laser $90/h
  - brake $2.50/bend + $20 setup, order setup $15
  - finishing $3.50/ft² + $35 batch setup
  - platform margin 35%, minimum order $29
- **Shop Console token:** label `dev-console`, hash only. On first run it is printed once. Set `SEED_SHOP_TOKEN` (or pass `seed(db, { shopToken })`) for a deterministic token in tests and e2e.

## 9. Environment variables

| Variable | Required | Used by | Notes |
|---|---|---|---|
| `APP_URL` | yes | all | Public base URL for signed links, Stripe redirects and passport QR codes |
| `DATABASE_URL` | yes | db | Postgres 16 (Supabase/Neon in staging and prod) |
| `STORAGE_DRIVER` | yes | storage | `local` (dev) or `s3` |
| `STORAGE_LOCAL_DIR` | local | storage | Default `.data/storage` (gitignored) |
| `STORAGE_SIGNING_SECRET` | local, prod | storage | HMAC for local signed URLs |
| `S3_ENDPOINT` | s3 | storage | R2, Supabase Storage S3 endpoint or MinIO. Omit for AWS |
| `S3_REGION` | s3 | storage | Default `auto` |
| `S3_BUCKET` | s3 | storage | |
| `S3_ACCESS_KEY_ID` | s3 | storage | |
| `S3_SECRET_ACCESS_KEY` | s3 | storage | |
| `S3_FORCE_PATH_STYLE` | s3 | storage | Default `true` |
| `PAYMENT_PROVIDER` | yes | payments | `stripe` or `dev` (dev refuses when `NODE_ENV=production`) |
| `STRIPE_SECRET_KEY` | stripe | payments | |
| `STRIPE_WEBHOOK_SECRET` | stripe | webhooks/stripe | |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | stripe | ui | Only needed if embedding Stripe Elements |
| `CARRIER` | yes | shipping | `easypost` or `manual` (manual refuses when `NODE_ENV=production`) |
| `EASYPOST_API_KEY` | easypost | shipping | |
| `EASYPOST_WEBHOOK_SECRET` | easypost | webhooks/easypost | |
| `ORDER_LINK_SECRET` | prod | auth/order-link | Rotating it revokes all buyer links |
| `PASSPORT_SIGNING_SECRET` | prod | passport | |
| `JOB_PACKET_SIGNING_SECRET` | prod | dispatch/shops | |
| `ADMIN_TOKEN` | for ops | auth/admin | Admin API disabled when unset |
| `CRON_SECRET` | prod | auth/admin | Bearer for the two scheduled-job routes only (Vercel Cron sends it) |
| `RESEND_API_KEY` | optional | notify | Console adapter when unset |
| `EMAIL_FROM` | optional | notify | |
| `OPS_EMAIL` | optional | notify | Target for `ops.alert` |
| `SEED_SHOP_TOKEN` | dev/e2e | seed | Deterministic Shop Console token |

## 10. Commands

```
bun run db:migrate      # apply migrations to DATABASE_URL
bun run db:seed         # idempotent catalog + dev shop (+ prints token once)
bun run db:generate     # after a schema.ts change (foundation only)
bun run typecheck       # tsc --noEmit
bun run lint            # eslint (next/core-web-vitals), zero warnings allowed
bun run test            # vitest (throwaway DB per suite)
bun run test:e2e        # playwright: next dev on :3100, fresh e2e DB (discovermake_e2e), PAYMENT_PROVIDER=dev, CARRIER=manual
bun run build
```

## 11. Integration changes (after the parallel build)

Contracts and schema (migration `0001_r1_integration.sql`):
- `MAX_PART_UPLOAD_BYTES` = 25 MB (was 50); the server enforces it with 413 and the UI checks it client-side.
- `LADDER_QUANTITIES` = 1 / 10 / 25 / 50 / 100 / 250 (single source; the quote engine re-exports it).
- `DfmFix.kind` gains `ADD_SERVICE` / `REMOVE_SERVICE` (`params.serviceId`); the configurator applies them in one tap.
- `PartFeatures.smallestFeatureMm` documented as the narrowest web/tab, excluding hole-to-edge (`minHoleToEdgeMm`).
- `JobPacket.part` gains `fileSha256` and `flatPatternSvgPath` (both signed). Jobs snapshot `source_file_key` / `source_file_sha256`; the console download URL and the passport file hash come from the snapshot.
- New table `shop_services`; quote routing and dispatch only consider shops that offer every selected finish / secondary op. `CreateShopRequest.serviceIds` onboards them.
- New events `dispatch.unmatched` and `job.cancelled`.
- Admin contracts moved into `src/contracts/admin.ts` (shop onboarding, refund, payout settle, cron responses); `AdminOrderDetail` gains `shipments[]` and `payouts[].method`.
- `ShopSessionResponse.shippingMode` tells the console which carrier adapter is live; `PassportPublicResponse` types the QR field.

Behaviour:
- Checkout also rejects quotes made under an older DFM rule set (same `isQuoteOrderable` predicate as `QuoteView.orderable`).
- Refunds (ops or provider-initiated) cancel open shop jobs in the same transaction.
- Only `dispatchOrder` raises the "no shop available" ops alert (the duplicate in the payment path is gone).
- Purchased EasyPost labels are copied into storage; the shop only ever gets short-lived signed links.
- Offer expiry and outbox publishing are scheduled (`vercel.json`), authenticated by `CRON_SECRET`.
- The "not implemented" stubs and test fallbacks are gone; unused dependencies from the old product were removed.

## 12. Open owner decisions and known gaps

| Item | Today | Needed before scale |
|---|---|---|
| Binding quotes on uncalibrated coefficients | Every rate card / catalog coefficient is `calibrated=false`, yet quotes are BINDING so R1 can take orders | Calibrate with the golden-part suite (±8 % vs shop invoices) or gate BINDING on `calibrated` |
| Quote-time shipping prices | Static versioned table on billable weight; platform absorbs carrier variance | Calibrate, or rate live through EasyPost at quote time |
| Payout when re-dispatched | Payout = quote `shop_cost_cents` even if another shop takes the job; the shop sees it before accepting | Decide whether re-dispatch re-quotes |
| Sales tax | 0 (tooltip says so) | Stripe Tax or equivalent |
| DXF parsing isolation | In-process with 25 MB / 250k-edge limits | Sandboxed worker with CPU/time limits + AV scan |
| EasyPost webhook signature | Legacy `X-Hmac-Signature` verified | Add the newer timestamped signature scheme |
| Dispatch / QA defaults | Scoring weights and inspection tolerances are documented R1 defaults | Tune with real shop data |
| Embedded payments | Hosted Stripe Checkout (`redirectUrl`) | Add `clientSecret` to `CheckoutResponse` if an embedded Payment Element is wanted |
| Pre-0001 shops | Shops created before migration 0001 have no `shop_services` rows and are only routed jobs with no finish / secondary op | Backfill their services via the admin API |
