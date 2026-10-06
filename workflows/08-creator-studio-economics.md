# 08 · Creator Studio + creator economics

**Question answered:** *What am I showing, selling, making and earning?*
Spec reference: §10.

## Routes

`/studio` · `/studio/products` · `/studio/builds` · `/studio/live` · `/studio/content` · `/studio/orders` · `/studio/audience` · `/studio/revenue`

## Publishing workflow

```
BUILD → PUBLISH → PRODUCT PAGE → LIVE ELIGIBLE → REMIX POLICY → ROYALTY POLICY → PRICING → LAUNCH
```

Publish states:
- `PRIVATE`
- `SHAREABLE`
- `PUBLIC`
- `FOR_SALE`
- `REMIXABLE`
- `LIVE_ELIGIBLE`

These are flags, so a Build can be `PUBLIC + FOR_SALE + REMIXABLE`.

Before something can be `FOR_SALE`, it needs:
- a valid quote route with at least one capable shop
- Makeability ≥ 80
- claims reviewed
- a prohibited-item screen passed

## Remix licensing

| License | Remix allowed | Commercial remix | Royalty to original |
|---|---|---|---|
| All rights reserved | No | No | — |
| Personal remix | Yes, for own use | No | Optional tip |
| Commercial remix | Yes | Yes | % of derivative sales (creator-set, default 10%) |
| Open (CC-BY-like) | Yes | Yes | Attribution only |

The license is stored on the Build. Remixes carry `DERIVED_FROM` edges, and royalties follow the lineage one level up by default. Multi-level splits are configurable.

## Economics (schema supports all of it in V1; automation phased)

| Stream | Paid to | When | Automated in |
|---|---|---|---|
| Product commission | Creator | Unit sold | R1 (own designs) |
| Build Recipe royalty | Creator | Others manufacture the design | R2 |
| Remix royalty | Original creator | Derivative sold | R4 |
| Live sales commission | Presenter | Attributable live sale | R4 |
| Affiliate / UGC commission | Clip/UGC creator | Attributable purchase | R5 |
| Factory revenue | Shop | Job delivered | R1 |
| Platform take | DiscoverMake | Every orchestrated transaction | R1 |

Implementation:
- A double-entry `ledger_entries` table records every split on each order line.
- Payouts go through Stripe Connect transfers, which the repo already has (`/maker/earnings`, `api/payouts/connect`).
- Holdback until the delivery and return window closes.
- Attribution:
  - last-touch with a 7-day window, with the live session, clip or UGC as the touchpoint
  - recorded on `order.attribution`

## Live Show Control (`/studio/live`)

Panels:
- current product
- next product queue
- viewers
- sales
- slots
- questions (from creator and from Make AI)

Actions:
- **Feature Product**
- **Start Drop**
- **Ask Make AI**
- **Bring Viewer On**
- **Clip Moment**
- **End Show**

Each action sends a host *intent* to `live-gateway` (workflow 06). It never sends raw commerce events.

**Go Live setup:**
- camera and mic check
- scenes (intro, build process, Q&A, close-up), modeled on OBS-style scene presets
- stream source: browser, phone, OBS (RTMP/SRT → MediaMTX), or a shop camera

## Show Planner

Objects:
- `Show`
- `Segment`
- `Product`
- `TalkingPoint`
- `Build`
- `Drop`
- `Poll`
- `Guest`
- `CTA`

A run-of-show builder produces the schedule (e.g. *Morning Make*) and pre-loads the product queue.

## Dashboard metrics

- Revenue, broken down by stream
- Build slots sold
- Live viewers (peak / average)
- Remix royalties
- Orders
- Conversion (viewer → Make This → paid)
- Watch time
- Top clips

## Reuse from current repo

- `/maker/publish`: 3-step publish wizard. Repurpose it for Build publishing.
- `/maker/earnings` + Stripe Connect.
- `/creator/store`: becomes the creator channel page `/channel/:creatorSlug`.
- `/admin/revenue` (recharts): pattern for the revenue dashboards.
