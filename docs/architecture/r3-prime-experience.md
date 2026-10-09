# R3 "Prime" customer experience

Stage 2 of `workflows/14-completion-plan.md`. This increment adds Prime membership, the build cart with "Complete your build" upsells, rating + UGC after delivery, tracking over a map, order chat with quick replies, address validation, live carrier rates and B2B invoices.

The Prime-core work runs alongside and is **not** part of this increment:
- supplier-route quotes;
- deposits and balances;
- the Delivery Promise engine (`src/server/promise/**`);
- promise credits.

This increment only exposes `membership.guaranteedDates` for the promise engine to read.

## Module map

| Area | Server | Routes | UI |
|---|---|---|---|
| Contracts | `src/contracts/prime.ts`, events in `src/contracts/events.ts` | — | — |
| Membership | `src/server/prime/{membership-config,benefits,billing,membership,order-benefits,stripe-events}.ts` | `/api/me/membership`, `/api/me/membership/dev`, `/api/admin/prime/trial-reminders` (cron) | `/prime`, `/me/membership`, Me → "Prime membership" |
| Build cart | `src/server/cart/{cart,owner,upsells,checkout,payment-group,preview}.ts` | `/api/me/cart/**` | cart pill (app layout), `/cart`, `/cart/done/:id`, "Complete your build" on `/parts/:id` |
| Checkout extras | `src/server/shipping/address-check.ts`, `src/server/cart/preview.ts` | `/api/checkout/{preview,address,invoice}` | Prime card, address warnings, "Pay by invoice" on `/checkout/:quoteId` |
| Live rates | `src/server/shipping/live-rates.ts` (called from the quote engine) | — | — |
| Invoices | `src/server/invoices/index.ts` | `/api/checkout/invoice`, `/api/admin/prime/invoices/:id/{wire,dev}` | `/admin/prime` |
| Chat + holds | `src/server/chat/index.ts`, `src/server/r3/{order-access,shop-access,images,mail}.ts` | `/api/orders/:id/messages[/upload]`, `/api/shop/jobs/:jobId/messages[/upload]`, `/api/shop/flags`, `/api/admin/prime/orders/:id/messages`, `/api/admin/prime/holds/:id` | order page, Shop Console job page, `/admin/prime` |
| Ratings | `src/server/ratings/index.ts` | `/api/orders/:id/rating[/upload]`, `/api/admin/prime/ratings/:id` | order page, `/admin/prime` |
| Map | `src/server/geo/{us-geo,great-circle,tracking-map}.ts` | `/api/orders/:id/tracking-map` | order page (`TrackingMap`) |

Schema: the `// R3 Prime experience` section at the end of `src/server/db/schema.ts`. The local migration is `database/migrations/0006_r3_prime_experience.sql`; the integrator regenerates it. The section has 12 new tables and no changes to existing tables. User references are plain text ids.

## Membership money flow

```
/prime "Start free trial" (signed in) ── POST /api/me/membership {plan}
   ├─ stripe: Checkout Session mode=subscription, price = STRIPE_PRIME_{MONTHLY,ANNUAL}_PRICE_ID,
   │          subscription_data.trial_period_days = PRIME_TRIAL_DAYS (7), metadata dm_membership_id/dm_user_id/dm_plan
   │          → Stripe hosts payment-method collection → customer.subscription.created (trialing)
   └─ dev:    immediate snapshot (trialing, trial_end = now + 7 d) through the same apply path
customer.subscription.updated/deleted ── POST /api/webhooks/stripe (signature verified)
   → routeStripeExtensionEvent → processMembershipEvent (webhook_events exactly-once)
   → applySubscriptionSnapshot: in-order (last_event_at), legal transitions only, audit + events
```

**Lifecycle.**
- The lifecycle is `incomplete → trialing → active → past_due → canceled`.
- `past_due → active` happens on a successful retry.
- After a cancel, a new subscription may start. It goes straight to `active`, because one user gets only one trial (`trial_used`).
- **Cancel** sets `cancel_at_period_end`. The member keeps every benefit until the trial or period ends.
- **Resume** clears the scheduled cancel.
- Benefits apply only while the status is `trialing` or `active`.

**Trial-ending reminder.**
- Cron `GET /api/admin/prime/trial-reminders` runs daily at 06:30 (`vercel.json`).
- It emails every trial that ends within 2 days and has not been reminded yet.
- Each send is claimed atomically by setting `trial_reminder_sent_at`, so overlapping runs never double-send.
- Each send emits `membership.trial_reminder_sent`.

**Dev double.**
- `POST /api/me/membership/dev {action: end_trial | renew | payment_failed | cancel_now}` sends the snapshots Stripe would send.
- It works only when `PAYMENT_PROVIDER=dev` and never in production.

## Benefits math (`applyMembershipBenefits`, pure)

There is one call site: `priceOrderForCheckout` in `src/server/orders/checkout.ts`. Single checkout, cart checkout, invoice checkout and the previews all go through it.

| Benefit | Rule (integer cents) |
|---|---|
| Free standard shipping | Applies when **all** of these hold: the buyer is a member, the method is `STANDARD`, the option is not LTL freight, and the qualifying subtotal is ≥ `PRIME_FREE_SHIPPING_THRESHOLD_CENTS` (default 7500). For a cart, the qualifying subtotal is the whole cart. Then shipping = 0. The platform absorbs the label, and the ledger records 0 shipping. |
| Pooled material pricing | `raw = floor(material × pct/100)`, with pct = `PRIME_MATERIAL_DISCOUNT_PCT` (default 10).<br>`costFloor = ceil(material × shopCost / subtotal)`.<br>`discount = min(raw, material − costFloor, platformFee)`.<br>The discount comes out of the platform fee only. The shop's pay (`shop_cost_cents`) never changes, and `shopCost + platformFee = subtotal` still holds. There is no discount when a `MINIMUM_ORDER` line applies. |
| Priority shop queue | `order_benefits.priority`. The Shop Console job list shows "Prime priority" and sorts those jobs first (`GET /api/shop/flags`). |
| Guaranteed dates | `order_benefits.guaranteed_dates` and `MembershipView.guaranteedDates` are read by the promise engine. This increment does no promise math. |
| Early access | `MembershipView.earlyAccess` is for live drops (Stage 3). |

For non-members the totals come back unchanged. For non-members, the "Prime members ship this free" card shows the saving the same function would apply (`primeOffer`).

## Build cart model (least-invasive design)

The R1 order model is **one quote per order**: `orders.quote_id`, plus jobs, payouts and the passport per order. Rather than adding order lines, a cart checkout creates **one order per part** and pays all of them with **one provider payment**:

- `carts` / `cart_items`:
  - There is one open cart per owner: a user id, or a device hash for guests (`dm_device`).
  - A cart holds one item per part. A newer quote of the same part replaces the older one.
  - Items reference immutable quote snapshots, so the cart never stores a price.
- **Sign-in merge.** `mergeGuestCart(userId, deviceHash)`:
  - runs lazily on every cart request of a signed-in user (idempotent);
  - can also be called by the accounts module at sign-in;
  - lets the newest item per part win, and marks the guest cart `merged`.
- `cart_checkouts` is a **payment group**. It stores:
  - the provider reference: a Stripe Checkout Session, a dev session or an invoice id;
  - the order ids and the amount;
  - a signed confirmation token for `/cart/done/:id?t=`.
- Each order keeps its own `payments` row with `provider_ref = <group ref>#<n>` and its own total. Refunds, the ledger, payouts and the order state machine therefore stay per order.
- Webhooks for the group reference are fanned out by `dispatchGroupPaymentEvent`. It is called first in `processPaymentWebhook` and from the dev double. It:
  1. verifies the provider amount equals the group amount and the sum of the order payments (a mismatch raises an ops alert and advances nothing);
  2. calls `handlePaymentSucceeded` / `handlePaymentFailed` once per order, so the same idempotency and ledger rules apply.
- **Known limitation.** A Stripe refund of one cart order is a partial refund of the shared PaymentIntent. The `charge.refunded` echo may then match a sibling payment row. That row is left untouched and ops get a reconciliation alert (existing behaviour for partial refunds).
- Cart orders do not go through the Prime-core deposit flow. They are standard binding quotes paid in full.

**Upsells.**
- Every offer is a persisted engine quote (`createQuote`) for a modified configuration:
  - **spare part**: quantity + 1;
  - **powder coat**: matte black, when the material takes it and no finish is set;
  - **hardware kit**: the new `svc_hardware_kit` catalog service, with `featureCount` = the round clearance holes matching an ISO metric size, from `parts.features.holes`.
- Offers are computed once per base quote (`upsell_offers`). Only orderable offers are shown.
- The client sends the upsell **kind** only. The cart swaps in the engine's quote.

## Order chat authz

| Party | How | Miss |
|---|---|---|
| Buyer | order link token (`x-order-token` / `?t=`) or signed-in owner (`orders.buyer_user_id`, or a verified email equal to the buyer email) | 404 |
| Shop | Shop Console session; only the shop assigned to the order (`orders.shop_id`) through its job | 404 (another shop), 401 (no session) |
| Ops | admin token or ops/admin session (`requireAdmin`) | 401 |

**Messages.**
- Messages are plain text, at most 2,000 characters (checked in the DB too).
- Links render client-side as `http(s)` anchors only, with `rel="noopener noreferrer nofollow ugc"`. No HTML is ever injected.
- Attachments are images only: a signed PUT under `chat/<orderId>/`, then a server-side size and magic-byte check (PNG / JPEG / WebP). Anything else is deleted.
- Each party may post at most 30 messages per 10 minutes per order.
- Unread counts per party come from `order_chat_state.last_read_at`.
- Email notifications are throttled to one per order and party per 10 minutes. The slot is claimed atomically on `order_chat_state.last_notified_at`.
- Clients poll every 4 s.

**Quick replies** depend on the order status:
- buyer: "Where is my order?" (always; it gets an automatic status reply);
- buyer: "Approve change" and "Send photo" (in production);
- buyer: "Hold production" (paid and not yet shipped, with no open hold);
- shop: "Send photo".

**Hold production.**
- It creates a `hold_requests` row and an ops alert.
- It **never pauses a job by itself**.
- Ops confirm or decline it in `/admin/prime`, and the answer is posted in the thread (`hold.resolved`).

## Ratings + UGC

- A buyer can rate only `DELIVERED` / `COMPLETE` orders, once per order (unique index).
- A rating has 1–5 stars, tags (quality, fit, finish, packaging, on time), and an optional caption (280 characters) and photo (`ugc/<orderId>/`, same image checks).
- Every rating starts `pending`. Ops approve or reject it.
- `shops.rating` and `rating_count` are recomputed from **approved** ratings in the moderation transaction. The route and shop cards already read them.

## Tracking map and offline fallback

- `GET /api/orders/:id/tracking-map` (buyer auth) geocodes the shop and the destination **offline** (`src/server/geo/us-geo.ts`):
  1. first a table of major US cities;
  2. otherwise the state centroid from the region or the 3-digit ZIP prefix.
- It returns:
  - a 64-segment great-circle line;
  - a progress estimate from the shipment status and dates;
  - the current point;
  - one status sentence;
  - the carrier card (carrier, service, tracking number, last scan).
- When `NEXT_PUBLIC_MAP_STYLE_URL` is set, the client lazy-loads MapLibre (`import('maplibre-gl')`) with that style. It falls back to the SVG map on any map error.
- When it is unset (e2e, air-gapped deployments), the client draws an SVG US outline with both points, the dashed route and the travelled part. No tiles and no network requests.

## Address validation and live rates

- `POST /api/checkout/address` returns **non-blocking** warnings plus a suggestion. The UI offers "Use suggested address".
  - With `CARRIER=easypost` and `EASYPOST_API_KEY`, it uses EasyPost verification (`verify: ['delivery']`).
  - Otherwise it uses heuristics: ZIP prefix vs state, a PO box with LTL freight, and a missing unit for buildings that look multi-unit.
- Live carrier rates (`quoteShippingOptions`):
  - When EasyPost is configured, the quote engine rates the quote's parcel from the shop ZIP to a reference ZIP (66044) and maps the rates to Standard / Expedited / Express, with a 10% handling margin. Faster methods are never cheaper than slower ones.
  - The rates are cached per parcel + zone (3-digit ZIP pair) for 15 minutes.
  - Any error, freight-size parcel or missing key falls back to the versioned rate table.

## B2B invoices

- "Pay by invoice (ACH / wire)" is on single checkout and on the cart. It requires a company name.
- **Stripe:**
  - an Invoice with `collection_method: 'send_invoice'`, `days_until_due` 15 / 30 and `payment_settings.payment_method_types: ['us_bank_account', 'customer_balance']`, finalized and sent by Stripe;
  - `invoice.paid` / `invoice.overdue` / `invoice.voided` arrive on the Stripe webhook (`metadata.dm_invoice_id`).
- **Dev double:** `POST /api/admin/prime/invoices/:id/dev {outcome}`.
- Orders stay `PENDING_PAYMENT`, so there is no dispatch and no production, until the invoice is **paid**. The payment then runs through the shared payment pipeline (`settleInvoice`). An overdue invoice is flagged and ops are alerted. A voided invoice fails the payments.
- **Manual wire.** Ops record the bank reference in `/admin/prime`. This:
  - marks the invoice paid at the provider (`paid_out_of_band`, best effort);
  - pays the orders;
  - stores `marked_paid_by` and `paid_reference`;
  - emits `invoice.paid {method: 'manual_wire'}`.

## Events (`src/contracts/events.ts`)

- `membership.trial_started`
- `membership.status_changed`
- `membership.cancel_scheduled`
- `membership.resumed`
- `membership.trial_reminder_sent`
- `cart.checked_out`
- `rating.submitted`, `rating.moderated`
- `order.message_posted`
- `hold.requested`, `hold.resolved`
- `invoice.created`, `invoice.paid`, `invoice.overdue`

Chat and membership events have no `order_id` on the row, so they stay off the buyer timeline.

## Owner inputs

| Input | Env / setting | Default |
|---|---|---|
| Prime prices (cents) | `PRIME_MONTHLY_PRICE_CENTS`, `PRIME_ANNUAL_PRICE_CENTS` | 999 / 9900 |
| Trial length | `PRIME_TRIAL_DAYS` | 7 |
| Free-shipping threshold | `PRIME_FREE_SHIPPING_THRESHOLD_CENTS` | 7500 |
| Member material discount | `PRIME_MATERIAL_DISCOUNT_PCT` | 10 |
| Stripe Billing product prices | `STRIPE_PRIME_MONTHLY_PRICE_ID`, `STRIPE_PRIME_ANNUAL_PRICE_ID` (recurring Prices). Also enable `customer.subscription.*` and `invoice.*` events on the existing webhook endpoint, and ACH + bank transfer in the Dashboard. | unset: Prime answers 503 under `PAYMENT_PROVIDER=stripe` |
| Carrier | `CARRIER=easypost`, `EASYPOST_API_KEY` (address verification + live rates) | manual / rate table |
| Map tiles | `NEXT_PUBLIC_MAP_STYLE_URL` (MapLibre style JSON URL) | unset: offline SVG map |
| Ops email | `OPS_EMAIL` (holds, overdue invoices, chat) | unset: console |

## Integration notes

- **Accounts:** routes use `getViewer` / `requireViewer` / `getDeviceHash` / `resolveDevice` / `applyDevice` and `requireAdmin` (async).
- **Seed:** adds the `svc_hardware_kit` catalog service. The dev shop offers every seeded service.
- **Shared files touched:**
  - `src/server/orders/checkout.ts`: `priceOrderForCheckout`, plus the `membership` option on `createCheckout`;
  - `src/server/orders/webhooks.ts`: the group hook;
  - `src/server/orders/dev-payment.ts` and `src/server/payments/dev.ts`: group refs;
  - `src/app/api/webhooks/stripe/route.ts`: the R3 event router;
  - `src/server/quote/quotes.ts`: live rates;
  - `src/app/(app)/layout.tsx`: the cart pill;
  - UI insertions in checkout, configure, the order tracker, Shop Console job / inbox, the ops board and Me.
