# R5 · DiscoverMake Media: the manufacturing-to-media network

Stage 4 of the completion plan (workflow 14), built from workflow 07 (media network), workflow 08
(Creator Studio + economics), workflow 09 (Watch My Build) and workflow 06 (drops, auctions, For You).
The contract is `src/contracts/media.ts` plus additive fields in `src/contracts/live.ts`.

> G3 demo: a replay clip sells a remix whose royalty is paid to its creator; the buyer's own build
> stream shows every milestone. `tests/e2e/media-journey.spec.ts` runs it (phone 390 px viewer,
> desktop 1280 px creator), plus a two-bidder auction with the anti-snipe extension.

## 1. Module map

| Layer | Where | What |
|---|---|---|
| Contract | `src/contracts/media.ts`, `src/contracts/live.ts` (R5 extensions) | publications, licences, cards, feed, search, clips, insights, payouts, Watch My Build; auctions, fair queue |
| Schema | `src/server/db/schema.ts` (`// R5 Media`), migration `0010_r5_media` | build_publications, creator_accounts, creator_earnings, creator_payouts, clips, drop_queues, drop_queue_entries, auctions, auction_bids, feed_events; ledger account `CREATOR_PAYABLE` |
| Server | `src/server/media/**` | `publish.ts` (publishing, licence gate, Make This / Remix, build page, remix tree), `economics.ts` (earnings, reversal, balance, payouts), `connect.ts` (creator Connect), `clips.ts`, `feed.ts`, `search.ts`, `channels.ts`, `insights.ts`, `watch.ts`, `cards.ts` |
| Live | `src/server/live/queue.ts`, `src/server/live/auctions.ts`, `drops.ts` (`claimSlotsLocked`) | fair queue, live auctions |
| Hooks | `orders/payment-events.ts` | `accrueCreatorEarnings` after the payment split, `reverseCreatorEarnings` after the refund reversal (same transaction) |
| Routes | `src/app/api/media/**`, `api/live/auctions/**`, `api/live/drops/:id/queue`, `api/orders/:id/watch`, `api/admin/creator-payouts/**`, `api/admin/live/auctions/close` | HTTP surface (below) |
| UI | `src/components/media/**`, `components/live/auction-*`, `components/studio/auction-panel.tsx` | Discover feed, `/b/[buildId]`, `/c/[handle]`, `/clips/[clipId]`, `/studio/insights`, `/studio/publish`, `/studio/payouts`, `/orders/[id]/watch`, auction card + bid sheet, queue state in the claim sheet, replay chapters |

## 2. Publishing and licences

A build owner (signed in; guest builds are claimed at sign-in first) publishes from Creator Studio ·
Publishing (`POST /api/media/builds/:id/publish`): visibility `private | public`, licence, royalty %
(0–30, default 10), title, description, up to 8 tags (tags that are onboarding interest slugs become the
build's `interests`, which seed For You) and a cover (a verified image attachment of the build, served
only for public builds by `/api/media/builds/:id/cover`; otherwise the part's flat-pattern preview).
`build.published` is emitted. Published builds appear in Discover, on the creator's channel and at
`/b/:buildId` (OpenGraph + Twitter card metadata from `generateMetadata`, public builds only).

| Licence | Make This (clone) | Remix | Publish / sell the derivative | Royalty to the parent creator |
|---|---|---|---|---|
| `none` (all rights reserved) | yes | **no** (403 `LICENSE`) | no | on Make This orders |
| `personal` | yes | yes | **no** (the remix stays private; it can be ordered) | on every order of the derivative |
| `commercial` | yes | yes | yes | on every order of the derivative |

Rules (V1):
- A build with **no publication row** keeps the R2 behaviour: anyone holding its id may fork it.
- A publication that went **private** again answers 404 to everyone but its owner (build page, forks).
- The gate (`assertCanFork`) runs in the new `POST /api/media/builds/:id/make` and in the R2
  `/api/builds/:id/remix` and `/clone` routes. Owners may always remix their own designs.
- **Make This / Remix** forks the Build Graph when the source has an APPROVED version (R2 `forkBuild`)
  and always copies the latest analyzed flat pattern (bytes re-verified, re-analyzed), so the new build
  is orderable at once. The response's `nextUrl` is the part configurator.

## 3. Creator economics

### Who earns on a paid order
`accrueCreatorEarnings(orderId, tx)` runs inside `handlePaymentSucceeded`, right after the R1 payment
split, for every full-payment order (direct checkouts, captured Build Slots, captured winning bids):

1. **Live revenue.** A `BUILD_SLOT` order of a drop, or the winning `LIVE_DROP` bid of an auction, earns
   the channel owner the markup over the binding price: `order.platform_fee − quote.platform_fee × qty /
   quote.quantity` (never below 0). Kinds `DROP_REVENUE`, `AUCTION_REVENUE`.
2. **Royalty.** When the ordered build has `derived_from_build_id = P` and P has a publication with a
   royalty, P's owner earns `floor(subtotal × pct / 100)` (subtotal excludes shipping and tax), **capped
   at the platform fee left after live revenue** (the platform never pays more than it earned). Kinds
   `MAKE_THIS_ROYALTY` (clone) and `REMIX_ROYALTY`. **Only the direct parent's creator in V1**:
   multi-level splits (grand-parents) are deferred; the schema keeps `source_build_id` per row so they can
   be added without migrations.
3. **No self-royalty**: skipped when the parent creator is the buyer (user id or email), owns the
   derivative, or is the drop / auction host.

### Postings (`creator_earnings` is the per-creator subledger; every row mirrors one balanced txn)

| txn_key | Lines |
|---|---|
| `creator:<orderId>:<kind>` | DEBIT `PLATFORM_REVENUE` / CREDIT `CREATOR_PAYABLE` (accrual, `royalty.accrued`) |
| `creator_reversal:<orderId>:<kind>` | DEBIT `CREATOR_PAYABLE` / CREDIT `PLATFORM_REVENUE` (full refund, `royalty.reversed`, negative subledger row) |
| `creator_payout:<payoutId>` | DEBIT `CREATOR_PAYABLE` / CREDIT `PAYOUTS_IN_TRANSIT` (`creator.payout_created`) |
| `creator_payout_settle:<payoutId>` | DEBIT `PAYOUTS_IN_TRANSIT` / CREDIT `CASH` (transfer created or ops marked paid, `creator.payout_paid`) |
| `creator_payout_fail:<payoutId>` | DEBIT `PAYOUTS_IN_TRANSIT` / CREDIT `CREATOR_PAYABLE` (transfer failed; money back on the balance) |

Balance = Σ earnings (reversals are negative) − payouts that are PENDING or PAID. A refund after a payout
is a clawback against future earnings (the balance can go negative; no payout until it is positive
again). Partial refunds are booked by R1 as `REFUNDS` only and do not reverse earnings (deferred).

### Worked example
Amanda publishes *Walnut lamp plate* with a commercial licence and a 10% royalty. Its binding quote is
10 units at $5.00 (shop cost $37.00, platform fee $13.00).

- Vic taps **Make Mine** on a clip: a clone with the same flat pattern; he orders 10 at the same price.
  Subtotal $50.00 → shop $37.00, platform fee $13.00. Royalty 10% × $50.00 = **$5.00** to Amanda
  (`MAKE_THIS_ROYALTY`); the platform keeps $8.00. Ledger: CASH +$65.00 (with $15 shipping);
  SHOP_PAYABLE $37.00, PLATFORM_REVENUE $13.00 − $5.00, CREATOR_PAYABLE $5.00, SHIPPING_PAYABLE $15.00.
- Amanda runs a drop of her plate at $9.00 per slot (binding quote at the 10-slot threshold: $5.00 with a
  $1.30 platform fee per unit). Each captured slot: platform fee $9.00 − $3.70 = $5.30, of which
  $5.30 − $1.30 = **$4.00** is Amanda's `DROP_REVENUE`.
- Vic is refunded: `creator_reversal:` moves $5.00 back from CREATOR_PAYABLE to PLATFORM_REVENUE;
  Amanda's balance drops by $5.00.

### Payouts
`/studio/payouts` (`POST /api/media/studio/payouts`) pays out the whole available balance (minimum
$1.00), serialized per creator by an advisory lock. **Connect**: the creator onboards with the shop
Express flow (`/api/media/studio/payouts/connect`, `creator_accounts`, the same `account.updated`
webhook); when payouts are enabled and Stripe is configured the payout transfers at once
(`createConnectTransfer`, idempotency key `payout:<payoutId>`) and the runner
`/api/admin/creator-payouts/run` (cron, `vercel.json`) retries pending ones. **Without Stripe (dev and
e2e)** payouts are `manual`: ops list them (`GET /api/admin/creator-payouts`) and settle them with
`POST /api/admin/creator-payouts/:id/paid { reference }` (`await requireAdmin`). Holdback until the
return window closes is deferred (owner policy).

## 4. Clips, replays, channels

- **Clip** = (show, start ms, end ms, title, featured build, product offset) pointing into the show's
  replay (`videoSourceFor(show)`); the player seeks and loops inside the range, muted, on hover / tap.
  Nothing is transcoded.
- **Suggestions** (`suggestClips`) come from the Live Build Protocol log: every `product.focus`,
  `drop.started` and `auction.started` becomes a window from 2 s before the moment to the next focus (or
  the show end), capped at 30 s, at least 3 s. At `end_show` the system clips each product moment
  (max 3, idempotent per event seq); hosts cut more from the control room of an ENDED show
  (`POST /api/media/shows/:id/clips`, 3–120 s). `clip.created` is emitted.
- **Clip cards** pin the product (Make Mine · Buy chips) from its timestamp; `/clips/:id` is the
  shareable player with a link to the full replay at the clip start.
- **Replays** gain a chapter list (show start, products, drops, auctions, factory milestones) and
  "Share this moment" links (`/live/:showId?t=<seconds>`; the player seeks on load).
- **Channels** `/c/:handle` (creator, factory and campus share the page): Live's channel API plus the
  owner's public builds, the channel's clips and replays (`GET /api/media/channels/:handle`).

## 5. Drops: fair queue · Auctions

### Fair queue (high-demand drops)
`start_drop { fairQueue: true }` adds a `drop_queues` row. Direct claims then answer 409; buyers join
the queue (`POST /api/live/drops/:id/queue`), one QUEUED entry per buyer, stored with its arrival
**second** and a random 31-bit **tie-break**. `processDropQueue` locks the drop row (the same lock as
direct claims) and admits entries whose second has fully passed, in `(second, tie-break, id)` order;
each runs the normal claim (`claimSlotsLocked`) in a savepoint, so a refused claim (sold out, per-buyer
limit, closed) marks the entry REJECTED with its reason and the next entry continues. Claims that land in
the same second are therefore ordered at random, not by network latency, and the row lock still makes
oversell impossible. Processing runs lazily on every join and position poll (the claim sheet polls once a
second and shows "You are number N in line") and from the drop sweep. Admitted entries are ordinary
RESERVED claims (authorize, capture at close).

### Live auctions (one-of-ones, Whatnot Custom + Bid)
- `start_auction { buildId, startingBidCents, minIncrementCents, durationSeconds }`: the starting bid
  must cover the orderable BINDING quote at quantity 1 (creators cannot sell below cost); signed
  `auction.started`.
- **Ladder**: a bid must be ≥ current + min increment (or the starting bid); the host cannot bid. Bids
  are serialized by the auction row lock.
- **Anti-snipe**: a bid landing with ≤ 10 s left moves the end **+15 s** (`antiSnipe`), counted in
  `extensions`.
- **Money**: each bid is a `LIVE_DROP` order with an authorize-only payment for bid + shipping (reuses the
  Build Slot authorize / capture / release pipeline); the bidder authorizes the hold (Stripe manual
  capture or the dev page). Only bids with an AUTHORIZED hold can win, so an unauthorized top bid cannot
  block the sale. Holds stay valid 35 min past the end.
- **Close** (cron-safe + lazy: any read after `endsAt`, the viewer's own card when its clock runs out,
  `POST|GET /api/admin/live/auctions/close`, or the host): the highest authorized bid is WON, other
  authorized bids LOST, unauthorized ones VOID; status SOLD / UNSOLD (CANCELLED when the host ends it
  before any bid); signed `auction.closed`. After commit the winner's hold is captured (order PAID →
  ledger, creator revenue, dispatch) and every other hold is released; settlement is idempotent and
  re-run by the sweep. The previous leader gets an `auction.outbid` email and an in-stream "You were
  outbid"; the winner gets `auction.won`.
- Live contract (additive): event types `auction.started`, `auction.bid`, `auction.closed` (all in
  `SIGNED_LIVE_EVENTS`), `AuctionView`, `ShowSnapshot.auction`, `DropView.fairQueue`, intents
  `start_auction` / `close_auction`, `start_drop.fairQueue`.

## 6. Watch My Build

`/orders/:id/watch` (signed order token, or the signed-in buyer; anything else is 404 like the order
API) is the buyer's own production stream, read straight from the records the Shop Console writes:
payment, job accepted, each milestone (material staged, cutting, bending, finishing, inspection,
packed) with its note and short-lived signed shop photos, QA passed / failed with inspection photos,
shipment, delivery. Nothing can be posted that did not happen. When the shop's channel
(`channels.shop_id`) has a `build_live` show featuring the order's build, live or about to start, it is
embedded; otherwise the photos stand in (cameras are the shop's own approved shows, no surveillance).
Order tracking shows a "Currently in production" card with a **Watch** button; the page refreshes every
10 s until delivery.

## 7. Discover feed, ranking, search

Tabs **For you · Live · New · Trending** (`GET /api/media/feed?tab=&cursor=`), a mobile-first masonry
grid with infinite scroll, search, and the starter catalog as "Start from a template".

**For You** (workflow 06 heuristic, `rankScore`, deterministic):

```
rank = interest × novelty × creator_quality × engagement × makeability × availability
interest     = 0.35 + 0.65 × min(1, |viewer ∩ item interests| / min(|item interests|, 2))   (1 without viewer picks; × 1.3 followed channel)
novelty      = 0.25 + 0.75 × e^(−age_days / 7)
creator      = 0.7 + 0.3 × min(1, log10(1 + followers + 2 × paid orders) / 2)
engagement   = 1 + 0.5 × log10(1 + clicks + 2 × plays + 4 × make_this + 8 × paid orders)    (last 14 days)
makeability  = 0.5 + 0.5 × score / 100   (0.75 unknown)
availability = 1 orderable · 0.85 makeable · 0.6 otherwise   (live shows ride on top)
```

Viewer interests are the onboarding "Pick 5" of the signed-in user, else of this device
(`device_preferences`). **New** orders by publish time, **Trending** by weighted engagement of the last
7 days, **Live** by live now › upcoming › clips › recent replays. Pages use an opaque keyset cursor over
`(score desc, id asc)` computed at a fixed `asOf`, so pages never repeat while new items arrive.
Candidates are the latest 400 public builds and 200 clips (fine for V1).

**Logging**: impressions (once per item per mount), clicks, plays, Make This / Remix go to `feed_events`
(`POST /api/media/feed/events`, shared limiter) for a future learned ranker.

**Search** (`GET /api/media/search?q=`): Postgres full-text search with prefix matching over
`build_publications.search_text` and `clips.search_text` (GIN expression indexes) and channels (name,
handle, bio). When the `pg_trgm` extension is installed (a trusted extension:
`CREATE EXTENSION pg_trgm`, no superuser needed on Postgres 13+) trigram similarity also catches typos
(`mode: "fts+trgm"`); without it the search is FTS only. **Similar builds** (`similarBuilds`) score
tag / interest overlap. Meilisearch (search) and Qdrant (similar builds, embeddings) can replace
`searchMedia` / `similarBuilds` and the feed's candidate stage behind the same interfaces.

## 8. Creator dashboards (`/studio/insights`)

SoundCloud Insights / DoorDash Merchant product mix / Square best sellers, with a 7d · 30d · 90d · all
range: stat tiles (earnings, royalties, live revenue, orders, remixes, show views, slot conversion),
earnings per day as stacked bars (plain SVG, hover tooltips, a table view), product mix (share of
earnings per build), best sellers (orders and remixes across the lineage), remix trees, and show stats
(views = max(peak viewers, presence rows on file) until a durable view log exists, likes, slots claimed,
slot conversion, revenue, clips). Chart colors are validated for the graphite surface (CVD ΔE 26.8).

## 9. HTTP surface

| Route | Auth | |
|---|---|---|
| `POST /api/media/builds/:id/publish` | owner | publish (limiter `media_publish`) |
| `GET /api/media/builds/:id` | public (owner for private) | build page |
| `POST /api/media/builds/:id/make` | public (owner = user / device) | Make This / Remix (limiter `media_make`) |
| `GET /api/media/builds/:id/cover` | public builds | cover image |
| `GET /api/media/feed`, `POST /api/media/feed/events`, `GET /api/media/search` | public | feed, logging (limiter `media_feed_events`), search (`media_search`) |
| `GET /api/media/channels/:handle`, `GET /api/media/clips/:id` | public | channel page, clip |
| `GET/POST /api/media/shows/:id/clips` | public / host | clips, suggestions, chapters, create (`media_clip`) |
| `GET /api/media/studio/{insights,publications,payouts}`, `POST /api/media/studio/payouts[/connect]` | signed in | dashboards, publishing, payouts |
| `POST/GET /api/live/drops/:id/queue` | signed in | fair queue (limiter `live_queue`) |
| `GET /api/live/auctions/:id`, `POST /api/live/auctions/:id/bids` | public / signed in | auction, bid (limiter `live_bid`) |
| `GET /api/orders/:id/watch` | order token or buyer | Watch My Build |
| `/api/admin/creator-payouts[/:id/paid,/run]`, `/api/admin/live/auctions/close` | admin (cron for run / close) | ops |

Every limiter is the shared `RateLimiter` (Postgres in production). Every admin guard is
`await requireAdmin` / `await requireAdminOrCron`.

## 10. Environment

No new variables. Creator Connect reuses `STRIPE_SECRET_KEY` / `STRIPE_CONNECT_WEBHOOK_SECRET`; the
crons reuse `CRON_SECRET`.

## 11. Deferred (and what the owner needs to decide)

- **CDN / transcoding**: clips seek inside the replay file; vertical 15/30/60 s renders with captions,
  thumbnails, an HLS ladder and a CDN need the video storage budget (owner input).
- **Content moderation pipeline** for publications, clips and descriptions (owner policy needed);
  today only Live chat is moderated.
- **Learned ranker** (workflow 06: once ~100K sessions are logged in `feed_events`), swipe-to-next.
- Multi-level royalty splits, affiliate / clip-creator commissions (attribution window), creator
  holdback until the return window closes, partial-refund reversals, creator terms / licence text
  (owner input), a durable show view log, one production batch per drop.
- Factory camera ingest (MediaMTX) and per-cell scoping for Watch My Build; today a shop's
  `build_live` show featuring the build is embedded.

## 12. Tests

- vitest `tests/media/**`: publish / visibility authz; licence enforcement (none / personal /
  commercial, routes and Make This with a real DXF copy); royalty accrual on payment and reversal on
  refund with balanced ledgers; no self-royalty; the split cap; creator payouts (manual through the admin
  route, Connect transfer path); insights aggregates incl. show stats; fair-queue ordering, positions and
  no oversell under concurrent processing; auction ladder, floor, anti-snipe, close capturing the
  authorized winner and releasing the others, lazy UNSOLD; clip suggestions, auto + host clips; Watch My
  Build authz (token, wrong token 404, owner) and milestone stream with the shop camera; ranking
  determinism and interest seeding (user and device), cursor paging, trending, feed events; FTS search
  (and the trigram path when pg_trgm can be installed).
- Playwright `tests/e2e/media-journey.spec.ts` (G3 demo + auction) and page-sweep screens `discover`,
  `build-page`, `channel`, `clip-player`, `studio-insights`, `studio-payouts`, `studio-publish`,
  `watch-my-build`, `auction-view`.
