# ADR-0003 · Live media stack: LiveKit core, MediaMTX ingest, Owncast channels

- **Status:** Accepted (draft for G2 review)
- **Date:** 2026-10-06

## Context
DiscoverMake Live must carry two kinds of traffic:
- interactive rooms, where hosts, co-hosts, viewers brought on stage, and AI agents are all participants;
- feeds from anywhere: phones, OBS, RTMP cameras, factory RTSP, robot cameras, SRT.

Candidates (stars as of Oct 2026):

| Project | Stars | License |
|---|---|---|
| LiveKit | ≈21K | Apache-2.0 |
| MediaMTX | ≈20K | MIT |
| Owncast | ≈11.6K | MIT |
| Streamplace | ≈227 | — (below our 5K-engagement bar) |

## Decision
1. **LiveKit is the realtime interaction plane.** It owns:
   - rooms
   - roles
   - data tracks
   - moderation
   - egress recording
   - Make AI as an Agents participant

   Start with LiveKit Cloud. Keep self-hosting possible.
2. **Ingest is phased:**
   - **R4:** browser and phone publish via the LiveKit SDKs, plus OBS via LiveKit Ingress (RTMP/WHIP).
   - **R4.5/R5:** **MediaMTX** in front for RTSP, SRT and industrial/robot cameras, and for universal protocol translation and recording near shops. It publishes into LiveKit.

   This reconciles "MediaMTX in front" (the live architecture memo) with "MediaMTX when factory sources expand" (scorecard §8).
3. **Owncast is the core broadcast and channel layer** (owner direction, 2026-10-06). It handles creator channels, scheduled programming and community chat. Broadcasts bridge into LiveKit rooms through RTMP → MediaMTX/Ingress whenever viewers need to interact (Make This, Remix, Ask Make AI, build slots).
4. **DiscoverMake owns the Live Build Protocol** (workflow 06). Video platforms only carry the bytes.
5. Streamplace: watch, and revisit for an AT Protocol bridge later.

## Consequences
- Every source becomes a uniform **LIVE SOURCE** to the product.
- Commerce state never goes into the video. It is a client overlay driven by validated, server-signed events.
- One vendor dependency (LiveKit Cloud) early on, with an Apache-2.0 self-host exit.
