# 07 · DiscoverMake Media: participatory industrial media

> Manufacturing becomes content. Content creates demand. Demand triggers manufacturing.
> *Watch the future being built. Then build yours.*

The media layer could end up as valuable as the manufacturing technology, because the MAKE Network produces content on its own. Every new factory, robot, creator and Build adds production capacity, and it also adds media. Every new viewer is a potential buyer, creator, production-run backer, remixer, or future manufacturer.

## Why this is defensible

When a viewer taps something on screen, DiscoverMake can answer from the **Build Graph**:

| Viewer asks | DiscoverMake answers from |
|---|---|
| What is that? | Part node |
| What material? | `MADE_OF` → MaterialSpec |
| Who made it? | `MANUFACTURED_BY` → Facility |
| What does it cost? | Quote / SupplierOffer |
| Can I buy one? | Product / Build Slot |
| Can I use that part in my project? | Fork the subgraph |
| Could mine be smaller? | Ask Make AI → remix |
| Can someone manufacture it? | Route via MAKE Network |

Video platforms and broadcasters do not have this. Their video is not linked to a structured manufacturing record.

## Channels (programming slate)

Mega Builds · Robots at Work · Made Live · Inventor TV · Factory Floor · Build Battles · Reconstruction · Luxury Builds · Future Mobility · Marine · Architecture · Fashion Lab · Campus Makers · Kids Make

**Premium long-form** examples: an 18-month yacht build, a submarine, a custom supercar, a stadium. These are captured as *structured media* while the work happens, not as a documentary made afterward.

- **Tap-to-identify overlays.** Tappable regions map to Build Graph parts. Positions come from LiveKit data events or replay annotations.
- **Confidential processes** stay private. Manufacturers publish approved cameras, specific work cells, milestone streams, telemetry visualizations and time-lapses.

## Content objects

| Object | Source | Links to |
|---|---|---|
| `LiveSession` | LiveKit room | Build(s), creator, channel |
| `Replay` | Egress / MediaMTX recording + event track | Every `product.focus` at its `stream_ts_ms` |
| `Clip` | Clip Engine | Moment + Build + creator |
| `CreatorContent` | Uploads, UGC | Build Graph (required) |
| `ProductionStory` | Auto-generated from manufacturing events | Order / Build |

## Clip Engine (R5)

1. **Detect moments** from:
   - the event track (product reveal, `drop.started`, `inspection.passed`, sale milestones)
   - audio and transcript (creator explanations)
   - chat spikes (audience reaction)
   - vision (machining moments, before/after)
2. **Cut** 15 / 30 / 60 s vertical clips with captions and an embedded product card that links to the Build.
3. **Publish** to the Discover feed, and optionally export to TikTok, YouTube Shorts and Reels with deep links back.
4. **Attribute.** Sales from a clip pay the clip's creator an affiliate share (workflow 08).

## Shoppable replays

The replay player reads the persisted event track. Scrub to 02:14 and Product A shows; scrub to 08:31 and Product B. The product card follows the timeline. Every past broadcast keeps selling.

## Manufacturing feed → storytelling

Private events turn into public narrative with permission:
- `DESIGN UPDATED`
- `MATERIAL SELECTED`
- `SUPPLIER APPROVED`
- `MACHINE RESERVED`
- `PRODUCTION STARTED`
- `QA PASSED`
- `SHIPPED`

AI drafts live updates, product stories, customer notifications and creator posts from them. The creator approves before anything is published.

## UGC loop

After delivery, the app prompts: *"Show us what you made."*
- Review video, a livestream of the product in use, a modification, a repair, or a fork.
- Every UGC object must reference the original Build Graph. That reference makes UGC transactable: `VIDEO → PRODUCT → DESIGN → CREATOR → MAKER → MATERIAL → MAKE THIS`.

## IRL recognition (R6)

Point the camera at an object, and DiscoverMake matches it against the Build index (multimodal embeddings, Qdrant). It overlays:
- similar builds
- an estimated reproduction cost
- a likely process
- **Reconstruct · Find similar · Make**

## Business model (stacked ARPU)

```
subscription (Prime / Media)
 → sponsorship + advertising (channel and show sponsors, material brands)
 → product purchase
 → custom remix fee
 → production fee (platform take on manufacturing)
 → supplier transaction (sourcing margin)
 → creator royalty (platform share)
 → factory revenue share
 → future replacement parts (Passport-driven)
```

A typical streaming subscriber is worth roughly $10–20 a month. A DiscoverMake viewer can watch a show and later commission a $30,000 product.

## Metrics

| Layer | North-star | Supporting |
|---|---|---|
| Media | Weekly watch hours on Build-linked content | Live sessions/week, clip views, replay watch % |
| Commerce from media | GMV attributed to live + clips + replays | Viewer → Make This rate, remix rate, slot fill rate |
| Flywheel | UGC posts per delivered order | Remixes of remixes, creator retention |

## Sequencing

- **R4:** Live (workflow 06) plus basic replays.
- **R5:** Channels, clip engine, shoppable replays, factory channels, drops and auctions, UGC.
- **R6:** IRL recognition, premium long-form partnerships (marine, mobility), media subscription tier.
