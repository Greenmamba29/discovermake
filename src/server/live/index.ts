/**
 * DiscoverMake Live (R4, workflow 06, ADR-0003, docs/architecture/r4-live.md).
 *
 *   events.ts      appendLiveEvent (seq under the show lock, stream_ts_ms, HMAC sig, outbox mirror)
 *   signing.ts     signLiveEvent / verifyLiveEvent
 *   snapshot.ts    ShowSnapshot for late joiners
 *   sse.ts         Server-Sent Events stream (Last-Event-ID resume, heartbeats, lifetime)
 *   intents.ts     host intents -> validated, signed events
 *   drops.ts       Live Drops + Build Slots (fair queue, authorize, capture / release)
 *   chat.ts        chat + moderation.ts (keywords, links, slow mode, mutes)
 *   questions.ts   Ask Creator / Ask Make AI (make-ai-answer.ts) / polls
 *   livekit.ts     token grants, rooms, webhook verification
 *   control.ts     likes, join tokens, LiveKit webhook effects, control room
 *   channels.ts / shows.ts   channels, follows, shows, Live home, Studio, go-live checklist
 *   queue.ts       R5 fair queue for high-demand drops (random tie-break within a second)
 *   auctions.ts    R5 one-of-one auctions: bid ladder, anti-snipe, authorize / capture / release
 */
export { loadShowAccess, requireHost, requireSignedIn, roleFor, publicName, actorFor, type ShowAccess, type LiveViewerRole } from './access';
export { appendLiveEvent, listLiveEvents, rowToLiveEvent, SYSTEM_LIVE_ACTOR, MAKE_AI_LIVE_ACTOR, type LiveActor, type AppendLiveEventInput } from './events';
export { signLiveEvent, verifyLiveEvent, liveSigningSecret, isSignedEventType } from './signing';
export { buildSnapshot } from './snapshot';
export { liveEventStream, resumeSeq, SSE_HEADERS, formatSseEvent } from './sse';
export { handleIntent } from './intents';
export { claimSlots, closeDrop, getDropView, maybeCloseDrop, minimumSlotPriceCents, settleDropClaims, startDrop, sweepDrops, viewerClaimsFor, CLAIM_HOLD_MINUTES } from './drops';
export { postChat } from './chat';
export { askQuestion, votePoll, currentPoll, listQuestions } from './questions';
export { answerLiveQuestion, CERTIFICATION_TEMPLATE, isSafetyQuestion } from './make-ai-answer';
export { moderateText, checkSlowMode, isMuted } from './moderation';
export { applyLiveKitWebhook, buildControlRoom, issueJoinToken, likeShow } from './control';
export { channelPage, setFollow, upsertChannel, channelByHandle, channelForOwner } from './channels';
export { createShow, liveHome, studioOverview, updateShow, featuredProductsFor, goLiveChecklist } from './shows';
export { computeFeaturedProduct, loadBuildFacts } from './featured';
export { liveKitConfig, isLiveKitConfigured, grantsForRole, receiveLiveKitWebhook } from './livekit';
export { limitLive, resetLiveRateLimits } from './rate-limit';
// R5: fair queue for high-demand drops, live auctions
export { claimSlotsLocked, isFairQueueDrop, type ClaimBuyer } from './drops';
export { dropQueueStatus, joinDropQueue, processDropQueue, sweepDropQueues } from './queue';
export { antiSnipe, auctionViewForShow, closeAuction, getAuctionView, maybeCloseAuction, nextMinimumBid, placeBid, settleAuction, startAuction, sweepAuctions } from './auctions';
