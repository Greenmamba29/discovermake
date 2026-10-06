# 06 · DiscoverMake Live: the live commerce network for things being made

**Positioning:** Discovery Channel showed you how the world is made. DiscoverMake lets you take part in making it.

Live adds the consumer loop to the creation engine:

```
Discover → Watch → Ask → Customize → Make → Buy → Follow → Share
```

Every stream is linked to a **Build Graph**, not a SKU. Viewers can Buy, **Make This** (clone), **Remix** (fork with changes), **Claim a Build Slot**, or commission a custom version without leaving the stream.

## Navigation

`Discover · Make · Live · Reconstruct · Materials · Robotics · My Builds` on mobile, with secondary items in the sheet. Creator Studio is reached from the avatar.

## Live formats

| Format | Who | V1? |
|---|---|---|
| Creator Live | Maker shows an invention | R4 |
| Product Live | QVC-style host, several products | R4 |
| Live Drop | Limited production slots ("143 / 500 remaining") | R4 |
| Build Live | Customers watch their own products being made | R4 (with Watch My Build, workflow 09) |
| Factory Live | Shop channel, approved cells only | R4 |
| UGC Live | Buyers show what they received | R5 |
| Material Live | Specialist compares materials and processes | R5 |
| Reconstruction Live | Rebuilding discontinued objects | R6 |
| Robot Live | Robot cell operation | R6+ |
| IRL Make | Phone camera from workshop, campus, jobsite or tradeshow | R4 (via phone publish) |

## Media architecture (ADR-0003)

```
PHONE ─┐ OBS ─┐ RTMP CAM ─┐ FACTORY RTSP ─┐ ROBOT CAM ─┐ SRT ─┐ WHIP ─┐
       └──────┴───────────┴───────────────┴────────────┴──────┴───────┘
                                   ▼
                     MediaMTX  (universal ingest + protocol translation + recording)
                                   ▼
                     LiveKit   (realtime rooms: hosts, guests, viewers, AI agents, data tracks)
                       │            │                │
                     VIDEO        CHAT         DATA EVENTS (Live Build Protocol)
                                   ▼
             live-gateway service (auth, moderation, protocol validation, persistence)
                 │                 │                     │
             BUILD GRAPH       COMMERCE (Medusa/Stripe)   MAKE AGENT (Q&A, remix)
                                   ▼
                          TEMPORAL workflows → MAKE Compiler → physical production
```

| Component | License | Responsibility |
|---|---|---|
| **LiveKit** (≈20.8K★, Apache-2.0) | Primary realtime plane | WebRTC rooms, host / co-host / guest, bring a viewer on stage, data channels, presence, moderation APIs, webhooks, egress recording, AI agents as participants (Agents framework) |
| **MediaMTX** (≈20.1K★, MIT) | Universal ingest gateway (R4.5/R5; R4 uses LiveKit Ingress for OBS RTMP/WHIP) | SRT, RTMP, RTSP, WebRTC/WHIP, LL-HLS, MPEG-TS, RTP in → publish to LiveKit (WHIP/ingress); proxying and recording |
| **Owncast** (≈11.5K★, MIT) | Optional | Self-hosted creator channels for creators who want to own their stack; bridge their stream into DiscoverMake via RTMP → MediaMTX |
| Streamplace (≈227★) | Watch only | AT Protocol live layer. Below our 5K-engagement bar. Revisit for a federation bridge later |

**Hosting.** Start with LiveKit Cloud to reach R4 quickly. Keep self-hosting possible: same SDKs, with MediaMTX on our own nodes near the shops. Use LiveKit Egress or MediaMTX recording for replays, stored with a time-indexed product-event track.

## Live Build Protocol (proprietary)

The video platforms carry the bytes. **DiscoverMake owns what the events mean.** Events travel on LiveKit data tracks and are validated by `live-gateway` against `contracts/live-event.schema.ts`. Every event is persisted with a stream timestamp so replays are shoppable.

```ts
type LiveEvent = {
  v: 1;
  event: LiveEventType;
  session_id: string;          // LIVE-984
  seq: number;                 // monotonic per session (ordering + gap detection)
  stream_ts_ms: number;        // position in the broadcast (replay sync)
  actor: { kind: "host" | "cohost" | "viewer" | "agent" | "system" | "machine"; id: string };
  build_id?: string; design_version?: number; variant_id?: string;
  payload: Record<string, unknown>;   // per-event zod schema
  sig?: string;                // server signature for commerce-affecting events
};
```

Event catalog:

| Group | Events |
|---|---|
| Product state | `product.focus` · `product.compare` · `variant.focus` · `material.change` · `price.change` · `inventory.change` |
| Remix | `remix.started` · `remix.created` |
| Drops | `drop.started` · `drop.ending` · `drop.closed` · `build_slot.claimed` |
| Q&A | `question.created` · `question.answered` (creator or Make AI) · `poll.created` · `poll.result` |
| Production | `machine.started` · `machine.completed` · `inspection.passed` · `prototype.completed` |
| Commerce | `order.created` · `order.completed` |

Example, mirroring spec §9.7:

```json
{ "v":1, "event":"product.focus", "session_id":"LIVE-984", "seq":212, "stream_ts_ms":1834000,
  "actor":{"kind":"host","id":"cr_amanda"}, "build_id":"DM-10482", "design_version":7,
  "variant_id":"walnut-v4",
  "payload":{"price":168,"lead_time_days":6,"makeability":94,"available_build_slots":117} }
```

Rules:
1. **Never burn commerce state into video.** The product card is a client overlay driven by events.
2. **Only the server issues commerce-affecting events** (price, inventory, slots, orders). Hosts send *intents* (`host.feature_product`) and the gateway validates them and emits the signed event.
3. **Late joiners** receive a state snapshot (current focus, slots, poll) on join. Then the event stream follows.

## Viewer experience (mobile-first, full-screen vertical)

```
┌─────────────────────────────────┐
│ ● LIVE · 12.4K        [Follow]  │
│                          ♡ 14K  │
│        LIVE VIDEO               │
│                          💬 923 │
│                          ↗      │
├─────────────────────────────────┤
│ NOW SHOWING  Titanium Trail Bottle
│ $142 · Grade 5 Ti · 284 g · Makeability 96 · 5–7 days
│ [ MAKE MINE ]  [ REMIX ]  [ BUY ]
│ 68 / 250 build slots left ▓▓▓▓░░
│ Ask: (Creator | Make AI)  ________ ▶
└─────────────────────────────────┘
```

- **Swipe** to the next stream, using the For You ranking below.
- The product card changes instantly on `product.focus`, with no reload.
- **Ask, in two modes:**
  - *Ask Creator* queues the question for the host.
  - *Ask Make AI* answers immediately from the Build Graph, the materials graph and claims the creator has approved. It can offer **[Create version]**.
- **Make This** clones the Build Graph and opens the configure sheet (workflow 04, screen 01) as an overlay. Video keeps playing.
- **Remix** takes text ("30% larger, orange"). Make AI forks the design and runs the pipeline with progress ticks (Geometry ✓ Material ✓ Manufacturing ✓ Makeability 91 · $117 · Sep 17). The viewer then taps **Make it**. The creator earns a remix royalty if the license allows it.
- **Claim Build Slot** is one tap with a saved payment method (authorize only).

## Make AI as co-host

- It joins the room as a LiveKit Agents participant with read access to the Build Graph, the materials catalog, price and lead time, approved claims, and manufacturing status.
- It answers viewer questions in chat (and optionally by voice) while the host keeps presenting.
- **Guardrails:**
  - It may only state claims in the approved-claims list, or claims derived from Build Graph data with confidence.
  - Safety and certification questions get conservative, templated answers ("final certification depends on production configuration").
  - Moderation applies to all of its outputs.

## For You ranking (TikTok-style discovery)

```
rank = interest(viewer, build tags) × novelty(build) × creator_quality × live_engagement
     × makeability × availability(slots, shops) × conversion_propensity × delivery_geo_fit
```

Start with a heuristic score and logging. Move to a learned ranker once there are about 100K sessions.

## Scheduled programming (QVC-style)

Creator Studio's Show Planner (workflow 08) builds schedules like *Morning Make*:

| Time | Segment |
|---|---|
| 9:00 | Inventor Spotlight |
| 9:20 | Maker Demo |
| 9:40 | Inside the Factory |
| 10:00 | Build Battle |
| 10:30 | Material Challenge |
| 11:00 | New Product Drop |
| 11:30 | Reconstruction Challenge |

## Build Slots: selling capacity, not inventory

The creator goes live with one prototype and sells N slots in a production run. DiscoverMake aggregates the orders, optimizes the batch, sources through Accio, and dispatches to the MAKE Network. Buyers then follow their batch through production. If the threshold is not met by the deadline, every authorization is released automatically.

```
LIVE DROP · Carbon Fiber Desk Lamp · $184
193 / 250 slots claimed · production starts at 200
[ CLAIM BUILD SLOT ]
```

**Live auctions** (one-of-one) reuse the drop mechanics with a bid ladder. They follow the Whatnot pattern: Custom + Bid buttons. Release R5.

## Moderation, trust and safety

- LiveKit moderation APIs (mute, remove, ban), a slow mode, and keyword filters on chat.
- Claims policy for products: no unverified safety or certification claims. Make AI enforces it in its own answers.
- Factory privacy: cameras are scoped per cell and per milestone, and approved by the shop. There is no unrestricted surveillance.
- Minors: age-gate purchases. Kids Make content is curated.

## Acceptance (spec §9.10)

A viewer can do all of these without leaving the stream:
1. enter
2. see the featured product
3. ask the creator
4. ask Make AI
5. see product state change in realtime
6. select a variant
7. Make This
8. Remix
9. Buy
10. claim a slot
