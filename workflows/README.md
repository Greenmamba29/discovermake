# DiscoverMake build workflows

**Discover. Make. Build.**

This folder is the delivery plan for the physical-product version of DiscoverMake. It works like SendCutSend: upload or describe a part, get an instant price, and have it made and shipped. On top of that it adds AI design (Make AI), a sourcing layer that runs in the background (the Accio wrapper), DoorDash-style ordering, Uber-style logistics, and a live-commerce media network.

The product contract is the V1 agent build spec, together with the MVP scorecard ([`docs/product/DISCOVERMAKE_MVP_SCORECARD_OPEN_SOURCE_ACCIO.md`](../docs/product/DISCOVERMAKE_MVP_SCORECARD_OPEN_SOURCE_ACCIO.md): competitive scores, open-source stack, Accio MCP architecture). The spec is here:
[`docs/product/DISCOVERMAKE_V1_AGENT_BUILD_SPEC.md`](../docs/product/DISCOVERMAKE_V1_AGENT_BUILD_SPEC.md).
These workflows say **how and in what order** that spec gets built. They follow a traditional SDLC with stage gates. Delivery inside each gate runs in sprints.

There is also a concept animation of the whole pipeline: [`public/concepts/transformer/`](../public/concepts/transformer/index.html). Once deployed, it is served at `/concepts/transformer/index.html`.

## How to read this folder

| # | Workflow | Answers | SDLC phase it drives |
|---|----------|---------|----------------------|
| 00 | [SDLC master plan](00-sdlc-master-plan.md) | Phases, gates, releases, roles, timeline | All |
| 01 | [Discover + Make intake](01-discover-make-intake.md) | How an idea, a file or a photo becomes a Build | Req → Impl |
| 02 | [Instant quote engine (SendCutSend core)](02-instant-quote-engine.md) | Geometry parsing, DFM, pricing, lead time | Req → Impl |
| 03 | [Accio sourcing bridge + Delivery Promise](03-accio-sourcing-and-delivery-promise.md) | Accio Work → DiscoverMake MCP, approval boundary, quote trust, Prime dates | Design → Impl |
| 04 | [On-demand ordering](04-on-demand-ordering.md) | Configure → Quote → Route → Approve → Build → Track | Req → Impl |
| 05 | [MAKE Network logistics](05-make-network-logistics.md) | Uber-style dispatch to shops, carriers, tracking | Design → Ops |
| 06 | [DiscoverMake Live](06-live-commerce.md) | LiveKit + MediaMTX + Owncast, Live Build Protocol | Design → Impl |
| 07 | [DiscoverMake Media](07-media-network.md) | Channels, clips, replays, media business model | Design → Ops |
| 08 | [Creator Studio + economics](08-creator-studio-economics.md) | Publishing, remix policy, royalties, payouts | Req → Impl |
| 09 | [My Builds + Product Passport](09-my-builds-passport.md) | Ownership, tracking, passport, reorders | Req → Impl |
| 10 | [Front end: Mobbin design plan](10-frontend-mobbin-design.md) | DoorDash ordering, Uber logistics, onboarding | Design → Impl |
| 11 | [Platform, data + security](11-platform-security-infra.md) | Stack, monorepo, data migration, secrets | Design → Ops |
| 12 | [QA, release + operations](12-qa-release-operations.md) | Test strategy, traceability, launch, support | Test → Ops |
| 13 | [Epics + backlog](13-epics-and-backlog.md) | GitHub epics, issues and sequencing | Impl |
| 14 | [Completion plan](14-completion-plan.md) | Stages to finish the whole app, Mobbin page-sweep results and coverage | Impl |

Architecture context:

- [`docs/architecture/current-state.md`](../docs/architecture/current-state.md): what exists in the three repos today
- [`docs/architecture/target-state.md`](../docs/architecture/target-state.md): the system we are building
- [`docs/adr/`](../docs/adr): the decisions behind it

## The two loops this plan delivers

```
CREATION LOOP     Imagine → Specify → Engineer → Source → Make → Verify → Deliver
CONSUMER LOOP     Discover → Watch → Ask → Customize → Make → Buy → Follow → Share
FLYWHEEL          WATCH → WANT → REMIX → MAKE → RECEIVE → SHOW → DISCOVER → MAKE AGAIN
```

Manufacturing becomes content. Content creates demand. Demand triggers manufacturing.

## Release train (summary; details in 00)

| Release | Name | What a customer can do |
|---------|------|------------------------|
| R1 | **Cut** | Upload a DXF/STEP, get an instant price, pay, receive laser-cut and bent parts |
| R2 | **Make + Source** | Describe or photograph an idea; Make AI produces a Build and CAD; Accio Work sources it through Alibaba in the background and offers come back with trust labels |
| R3 | **Prime** | Guaranteed delivery dates, optimized routes, membership |
| R4 | **Live** | Watch creators and shops live; Make This, Remix and Build Slots from the stream |
| R5 | **Media** | Channels, clips, shoppable replays, drops, Watch My Build |
| R6 | **Reconstruct** | Rebuild broken or discontinued objects from photos and scans |
