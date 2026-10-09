/**
 * LiveKit integration (ADR-0003): token service, rooms, webhooks.
 *
 * Enabled only when LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are all set.
 * Without them Live still works: a show plays its HLS/MP4 source (or a poster) and the
 * token endpoint answers `livekit: null`.
 *
 * Grants (least privilege):
 *   host    roomJoin + roomAdmin + canPublish + canPublishData + canSubscribe
 *   cohost  roomJoin + canPublish + canPublishData + canSubscribe
 *   viewer  roomJoin + canSubscribe only. No publish, no data publish: viewers act through
 *           the server API, which validates and signs every commerce-affecting event.
 */
import { AccessToken, RoomServiceClient, WebhookReceiver, type VideoGrant, type WebhookEvent } from 'livekit-server-sdk';
import { env } from '../env';

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };
export type LiveRole = 'host' | 'cohost' | 'viewer';

/** Viewer tokens are short-lived; the client asks again when it reconnects. */
export const LIVEKIT_TOKEN_TTL_SECONDS = 15 * 60;

export function liveKitConfig(): LiveKitConfig | null {
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env();
    return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

export function isLiveKitConfigured(): boolean {
    return liveKitConfig() !== null;
}

export function roomNameForShow(showId: string): string {
    return `dm-${showId}`;
}

export function grantsForRole(role: LiveRole, room: string): VideoGrant {
    switch (role) {
        case 'host':
            return { room, roomJoin: true, roomAdmin: true, canPublish: true, canPublishData: true, canSubscribe: true };
        case 'cohost':
            return { room, roomJoin: true, roomAdmin: false, canPublish: true, canPublishData: true, canSubscribe: true };
        case 'viewer':
            return { room, roomJoin: true, roomAdmin: false, canPublish: false, canPublishData: false, canSubscribe: true, canUpdateOwnMetadata: false };
    }
}

export async function createLiveKitToken(
    cfg: LiveKitConfig,
    input: { room: string; role: LiveRole; identity: string; name: string | null; ttlSeconds?: number },
): Promise<{ token: string; expiresAt: Date }> {
    const ttl = input.ttlSeconds ?? LIVEKIT_TOKEN_TTL_SECONDS;
    const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity: input.identity, name: input.name ?? undefined, ttl });
    at.addGrant(grantsForRole(input.role, input.room));
    return { token: await at.toJwt(), expiresAt: new Date(Date.now() + ttl * 1000) };
}

function roomService(cfg: LiveKitConfig): RoomServiceClient {
    const host = cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    return new RoomServiceClient(host, cfg.apiKey, cfg.apiSecret);
}

/** Create the show's room (idempotent at LiveKit). Best effort: LiveKit also creates rooms on first join. */
export async function ensureRoom(cfg: LiveKitConfig, room: string): Promise<void> {
    try {
        await roomService(cfg).createRoom({ name: room, emptyTimeout: 10 * 60, maxParticipants: 5000 });
    } catch (err) {
        console.warn(`[live] could not create LiveKit room ${room}`, err instanceof Error ? err.message : err);
    }
}

export async function closeRoom(cfg: LiveKitConfig, room: string): Promise<void> {
    try {
        await roomService(cfg).deleteRoom(room);
    } catch (err) {
        console.warn(`[live] could not delete LiveKit room ${room}`, err instanceof Error ? err.message : err);
    }
}

/**
 * Verify a LiveKit webhook (JWT in the Authorization header whose sha256 claim matches the
 * raw body, signed with our API secret). Throws on any mismatch.
 */
export async function receiveLiveKitWebhook(cfg: LiveKitConfig, rawBody: string, authHeader: string | null): Promise<WebhookEvent> {
    if (!authHeader) throw new Error('Missing Authorization header');
    return new WebhookReceiver(cfg.apiKey, cfg.apiSecret).receive(rawBody, authHeader);
}
