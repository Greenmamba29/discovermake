# R4 · DiscoverMake Live: architecture, protocol, money flow, setup

Stage 3 of the completion plan (workflow 14), built from workflow 06 (live commerce), workflow 08
(Creator Studio), ADR-0003 (media stack) and the contract in `src/contracts/live.ts`.

> Watch it made. Make it yours. A viewer can enter a show, see the featured product, ask the creator,
> ask Make AI, see product state change in realtime, Make This, Remix, Buy and claim a Build Slot
> without leaving the stream (spec §9.10). `tests/e2e/live-journey.spec.ts` runs that script.

## 1. Module map

| Layer | Where | What |
|---|---|---|
| Contract | `src/contracts/live.ts` | Channels, shows, Live Build Protocol events, drops, intents, tokens, snapshot, Studio / control room views |
| Schema | `src/server/db/schema.ts` (`// R4 Live`), migration `0006_r4_live` | channels, channel_follows, shows (`LIVE-<n>` sequence), show_featured_builds, live_events, live_questions, live_polls (+ votes), live_mutes, show_likes, live_presence, drops, slot_claims |
| Server | `src/server/live/**` | see below |
| Payments | `src/server/payments/**`, `src/server/orders/authorization.ts` | authorize / capture / release |
| Routes | `src/app/api/live/**`, `src/app/api/admin/live/drops/close`, `src/app/api/webhooks/livekit` | HTTP surface |
| UI | `src/components/live/**`, `src/components/studio/**`, `src/app/(live)/live/**`, `src/app/(app)/studio/**` | Live home, viewer, Creator Studio, control room |

`src/server/live/`:

| File | Responsibility |
|---|---|
| `events.ts` | `appendLiveEvent` (the only writer of `live_events`), `listLiveEvents`, row mapping |
| `signing.ts` | `signLiveEvent` / `verifyLiveEvent` (HMAC-SHA256) |
| `snapshot.ts` | `ShowSnapshot` for late joiners (and the full log for replays) |
| `sse.ts` | Server-Sent Events stream, `Last-Event-ID` resume, heartbeats, lifetime |
| `intents.ts` | Host intents → validated, signed events |
| `drops.ts` | Live drops and Build Slots: fair queue, holds, close, settlement, sweep |
| `chat.ts`, `moderation.ts` | Chat, keyword + link filter, slow mode, mutes |
| `questions.ts`, `make-ai-answer.ts` | Ask Creator, Ask Make AI (grounded), polls |
| `featured.ts` | Build record → `FeaturedProduct` (and Make AI grounding) |
| `livekit.ts`, `control.ts` | Token grants, rooms, webhooks; likes, join tokens, control room |
| `channels.ts`, `shows.ts`, `presence.ts`, `access.ts`, `views.ts`, `rate-limit.ts` | CRUD, Live home, Studio, go-live checklist, viewer counts, roles, mappers, limits |

## 2. Roles

| Role | Who | Can |
|---|---|---|
| host | the channel owner (`channels.owner_user_id`) | every intent on their shows |
| cohost | ops / admin staff | intents (moderation help on any show); per-show co-hosts are deferred |
| viewer | any signed-in user | chat, ask, vote, like, follow, claim slots |
| anonymous | signed out | watch, read the snapshot and the stream |

Accounts come from `src/server/auth/viewer.ts` (R2, session cookies). Every cookie-authenticated Live
mutation also runs `assertSameOrigin` (CSRF defence in depth on top of SameSite=Lax). User references in
Live tables are plain text user ids; channel owner display data is denormalized on the channel row.

## 3. Live Build Protocol

Every product, drop, Q&A and commerce change is a `LiveEvent`:

```json
{ "v": 1, "event": "product.focus", "showId": "shw_…", "seq": 212, "streamTsMs": 1834000,
  "actor": { "kind": "host", "id": "usr_…", "name": "Amanda" },
  "buildId": "bld_…", "designVersion": 7,
  "payload": { "...FeaturedProduct": "…" }, "at": "2026-10-09T19:02:11.000Z", "sig": "v1.9f…" }
```

**Ordering.** `appendLiveEvent(showId, …)` runs in one transaction: it locks the show row
(`SELECT … FOR UPDATE`), assigns `seq = shows.last_seq + 1`, computes `streamTsMs = at − started_at`
(0 before the show starts), signs, inserts, and advances `last_seq`. `unique (show_id, seq)` backs it up.
Seqs are gap-free and monotonic per show; clients detect gaps and dedupe with them.

**Signatures.** `SIGNED_LIVE_EVENTS` (product state, drops, slots, orders, show lifecycle) carry
`sig = "v1." + HMAC-SHA256(LIVE_EVENT_SIGNING_SECRET, canonicalJson(event without sig))`. `canonicalJson`
sorts keys and drops `undefined`, so signatures survive the jsonb round trip. The contract rejects signed
event types without `sig`; `appendLiveEvent` refuses to sign anything whose actor is a viewer. Hosts never
send events: they send intents and the server emits the signed events. `verifyLiveEvent` re-checks a
signature (server, agents, tests; HMAC needs the secret, so browsers trust the TLS stream and the
contract check).

**Outbox mirrors.** Events that matter outside the stream are mirrored to `domain_events` in the same
transaction: `live.show_started`, `live.show_ended`, `live.product_featured`, `live.drop_started`,
`live.slot_claimed`, `live.drop_closed`, plus the commerce events `order.created`, `payment.authorized`,
`payment.authorization_released`, `order.cancelled`.

**Late joiners.** `GET /api/live/shows/:id` returns a `ShowSnapshot`: show, last `product.focus` payload
(the exact signed state), current drop with the viewer's held slots and claims (with signed order
links), questions, the last 50 chat lines minus removed ones, current poll, slow mode, mute, like,
and `lastSeq`. `lastSeq` is read first; client reducers are idempotent (absolute counts, set-the-focus,
chat deduped by seq), so the overlap with the stream is harmless.

**Stream.** `GET /api/live/shows/:id/events?after=<seq>` is `text/event-stream`: one `data:` frame per
event with `id: <seq>`; the browser's `EventSource` reconnects with `Last-Event-ID` (which wins over
`after`). The handler polls the log about once a second, sends a heartbeat comment every 15 s, refreshes
presence, and closes after about 5 minutes so clients reconnect. `?format=json` returns
`{ events, lastSeq }` for polling clients and tests.

**Replays.** For ENDED shows the snapshot includes the whole log (`replayEvents`); the viewer folds it up
to the player's `currentTime` (or a scrubber when there is no recording), so the product card, slot
counter and Q&A replay in sync: shoppable replays.

**Client rule.** The NOW SHOWING card and the slot counter are overlays driven only by events
(`src/components/live/live-state.ts`). Commerce never goes into the video.

## 4. Host intents (`POST /api/live/shows/:id/intents`)

| Intent | Validation | Emits |
|---|---|---|
| `start_show` | SCHEDULED; creates the LiveKit room when configured | `show.started` |
| `end_show` | LIVE; deletes the room (egress then posts the replay URL) | `show.ended` |
| `feature_product` | build exists; show not ended; adds it to the featured list | `product.focus` (FeaturedProduct) |
| `start_drop` | see §5 | `drop.started` |
| `close_drop` | an OPEN drop on the show | `drop.closed`, then settlement |
| `answer_question` | question belongs to the show | `question.answered` |
| `create_poll` | closes the previous poll | `poll.created` (votes → `poll.result`) |
| `remove_chat` | target is a `chat.message` | `chat.removed` |
| `mute_viewer` | not the host | (none; enforced on chat / ask) |
| `slow_mode` | 0–300 s | system `chat.message` with `slowModeSeconds` |
| `machine_milestone` | LIVE | `machine.started` / `machine.completed` / `inspection.passed` / `prototype.completed` |

`FeaturedProduct` comes from the build record: the latest orderable BINDING quote for the build's latest
analyzed part (price, lead time, material, mass, makeability) and the latest APPROVED design version
(`canMakeThis` / `canRemix`). `canBuy` iff there is an orderable quote.

## 5. Drops and Build Slots: the money flow

```
start_drop ── price ≥ binding unit price at qty = thresholdSlots (creators cannot sell below cost)
   │          the drop must close before that quote expires
   ▼
claim (fair queue: drop row lock) ── BUILD_SLOT order (PENDING_PAYMENT)
   │                                  + authorize-only payment (Stripe capture_method=manual)
   │                                  slots held 35 min while the buyer authorizes
   ▼
authorized (webhook / dev page) ── payment AUTHORIZED, order still PENDING_PAYMENT, nothing charged
   ▼
close (host, deadline, cron) ── authorized slots ≥ threshold ?
   ├─ CONFIRMED: capture each hold → handlePaymentSucceeded → PAID, ledger split,
   │             production.authorized → dispatch to a partner shop + buyer confirmation
   └─ FAILED:    release each hold → payment CANCELLED, order CANCELLED, buyer notified
   (unauthorized claims always expire and are released; their slots return before close)
```

- **Fair queue.** Claims lock the drop row, so they are serialized; `claimed_slots` never exceeds
  `total_slots` (also a DB check) and a buyer never holds more than `perBuyerLimit` active slots.
  `Idempotency-Key` replays return the same claim.
- **Amounts.** Server-priced: `slot price × quantity` + the drop quote's shipping price for the chosen
  method. The shop's share is the quote's shop cost per unit × quantity; the platform fee is the rest
  (always ≥ 0 because of the price floor). Ledger and payouts are the R1 ones.
- **Claim lifecycle.** RESERVED → AUTHORIZED → CAPTURED, or RELEASED (drop failed) / EXPIRED (never
  authorized). Holds that run out are expired lazily (on claims, reads and the sweep), announced with a
  signed `inventory.change`, and released at the provider.
- **Closing.** `closeDrop` decides CONFIRMED / FAILED under the drop lock and appends `drop.closed`;
  settlement (capture / release) runs after commit and is idempotent per payment. If the process dies in
  between, `POST|GET /api/admin/live/drops/close` (admin token or `CRON_SECRET`, daily in `vercel.json`)
  re-runs it; overdue drops also close lazily whenever anyone reads them.
- **Late holds.** A hold authorized after its claim expired or its drop failed is released immediately.
- **Dispatch.** Each confirmed slot order is dispatched as its own job today; batching a drop into one
  production run is deferred (see §10).
- **Card holds.** Stripe card authorizations last about 7 days; the contract caps drops at 7 days.

Payments (`src/server/payments`): `createPayment({ captureMethod: 'manual' })`, `capture()`,
`cancelAuthorization()`. Stripe: Checkout Session with `payment_intent_data.capture_method = manual`,
card only, metadata `dm_capture=manual`; `checkout.session.completed` with `payment_status=unpaid`
becomes `payment.authorized`, `payment_intent.amount_capturable_updated` is the backup path. Capture uses
idempotency key `capture:<pi>`, release cancels the PaymentIntent or expires an open session. The dev
provider simulates all of it (its pay page posts the same webhook pipeline).

## 6. Chat, moderation, Q&A

- **Chat** (`POST /chat`, signed in): show scheduled or live; keyword filter (small blocklist matched on
  a normalized form: look-alike digits, spaced letters) and link blocking (URLs and bare domains);
  mutes; slow mode (hosts exempt); per-user rate limits (in-memory, like the R2 limits). Hosts remove
  lines (`chat.removed`); the log stays append-only and clients hide them.
- **Ask Creator** queues the question (`question.created`); the host answers from the control room.
- **Ask Make AI** answers at once, grounded only on the featured build's record (build, Build Graph
  requirements / materials / processes / open questions, the orderable quote). Requirements on the
  APPROVED version are the creator's approved claims. Guardrails: safety / certification / regulatory
  questions always get the template "Final certification depends on production configuration…"; a
  model answer is rejected for the record answer if it states any number not in the facts or the
  question; with Make AI disabled or keyless the answer is built deterministically from the record and
  says so. Answers are moderated too.
- **Polls**: one vote per signed-in viewer, live counts via `poll.result`.

## 7. LiveKit

When `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are all set:

- `start_show` creates the room `dm-<showId>` (best effort; LiveKit also creates rooms on first join).
- `POST /api/live/shows/:id/token` returns a 15-minute JWT (`AccessToken`) with role-scoped grants:
  host `roomJoin + roomAdmin + canPublish + canPublishData + canSubscribe`; cohost the same without
  `roomAdmin`; viewer `roomJoin + canSubscribe` only (no publish, no data publish: viewers act through
  the API, which validates and signs). Identity is the user id, or `anon-<device hash prefix>`.
- `POST /api/webhooks/livekit` is verified with `WebhookReceiver` (JWT signed with the API secret,
  `sha256` claim over the raw body; anything else is 401). It applies participant joins / leaves
  (viewer count), `room_finished`, and `egress_ended` (sets the replay URL from the file or HLS output).

Without LiveKit the token endpoint answers `livekit: null`; a show plays its HLS source
(Owncast / MediaMTX, via hls.js or native HLS), its recorded replay (file), or a poster with a plain
status line, and viewer counts come from SSE presence heartbeats. Commerce works the same either way.

**Owner setup (LiveKit Cloud):**
1. Create a project at cloud.livekit.io; copy the WebSocket URL (`wss://<project>.livekit.cloud`),
   an API key and its secret into `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
2. Project settings → Webhooks: add `https://<app>/api/webhooks/livekit` (signed with that key pair).
3. For replays, enable Egress (room composite to your storage); the `egress_ended` webhook stores the
   output URL on the show. For OBS, create an Ingress (RTMP/WHIP) for the creator's room.
4. Set `LIVE_EVENT_SIGNING_SECRET` (32+ random characters) in production; it is required there.

## 8. Environment

| Variable | Purpose |
|---|---|
| `LIVE_EVENT_SIGNING_SECRET` | HMAC key for signed Live events (required in production; dev fallback elsewhere) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit rooms, tokens, webhooks (all three or none) |

The drop sweep reuses `ADMIN_TOKEN` / `CRON_SECRET`.

## 9. UI

| Route | Pattern (workflow 10) | Notes |
|---|---|---|
| `/live` | Whatnot home live feed | LIVE now rail with viewer badges, channel chips, upcoming schedule, shoppable replays, honest empty states, Go live |
| `/live/[showId]` | Whatnot live show | Phones: full-height vertical stage with chat, NOW SHOWING card (Make Mine · Remix · Buy), Build Slot counter and composer over the video, right rail (like · ask · share · cart). Desktop: two columns. Make Mine clones the approved version (existing clone API) and opens a configure sheet over the stream (the video keeps playing); Remix sends the change text to the existing remix API with progress; Buy goes to the existing checkout; Claim collects the ship-to and authorizes the hold without leaving the stream (Stripe redirects back to the show) |
| `/studio` | Whatnot go-live checklist | Become a creator (`PATCH /api/me`), channel setup, show planner, shows list |
| `/studio/shows/[showId]` | Live studio controls | Start / end, feature products, start / close drops, answer questions, polls, moderation (remove, mute, slow mode), production milestones, live stats |

The site header and bottom nav are owned elsewhere; the integrator adds the Live tab.

## 10. Deferred

- **Ingest hosting:** MediaMTX (RTSP/SRT/factory and robot cameras, R4.5) and Owncast channel hosting.
  Today a show takes an HLS URL from either, or LiveKit.
- **Make AI as a LiveKit Agents co-host** (voice, in-room). Ask Make AI answers through the API today,
  with the same grounding and guardrails.
- **Push transport:** Postgres `LISTEN/NOTIFY` or LiveKit data tracks instead of 1 s polling in the SSE
  handler (payloads and seq semantics stay the same).
- **One batch per drop** for production (dispatch currently creates one job per slot order).
- Per-show co-hosts, Bring Viewer On, swipe-to-next. Clip Moment, live auctions, the fair queue,
  creator payouts, the channel page and For You ranking shipped in R5: see `r5-media.md`.

## 11. Tests

- vitest `tests/live/**`: seq monotonic under 25 concurrent appends; sign / verify / tamper; viewers get
  403 on intents (and server code refuses to sign for a viewer); snapshot correctness; SSE `after` and
  `Last-Event-ID` resume, heartbeat and lifetime; no oversell and per-buyer limits under concurrent
  claims; idempotency keys; CONFIRMED captures every hold and pays the orders, FAILED releases every
  hold and cancels them, late holds are released; the start_drop price floor; moderation; Make AI
  certification template, offline answers and no invented numbers; LiveKit grants per role (decoded
  JWT) and webhook signature rejection; the client reducer; the demo seed.
- Playwright `tests/e2e/live-journey.spec.ts` (spec §9.10) and the page-sweep entries `live-home`,
  `live-viewer`, `live-replay`, `studio`, `control-room`.
