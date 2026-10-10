/**
 * Request helpers for the Build Workspace routes: per-IP rate limiters on the shared store
 * (src/server/rate-limit: Postgres in production, memory in dev/test) and the guest device
 * hash recorded on attachments.
 */
import { getDeviceHash } from '../auth/device';
import { CompositeRateLimiter, RateLimiter } from '../rate-limit';

const limiter = (name: string, perIp: number, global: number) =>
    new CompositeRateLimiter(
        new RateLimiter(`${name}_ip`, { kind: 'fixed_window', limit: perIp, windowMs: 60_000 }),
        new RateLimiter(`${name}_global`, { kind: 'fixed_window', limit: global, windowMs: 60_000 }),
    );

/** Ask Make AI: each ask is a paid model call. */
export const ASSISTANT_ASK_RATE_LIMIT = { perIp: 10, global: 120 } as const;
export const assistantAskLimiter = limiter('workspace_assistant', ASSISTANT_ASK_RATE_LIMIT.perIp, ASSISTANT_ASK_RATE_LIMIT.global);

/** Attachment create / complete / delete / use-as-part (one file is 2-3 requests). */
export const ATTACHMENT_WRITE_RATE_LIMIT = { perIp: 60, global: 1200 } as const;
export const attachmentWriteLimiter = limiter('workspace_attachments', ATTACHMENT_WRITE_RATE_LIMIT.perIp, ATTACHMENT_WRITE_RATE_LIMIT.global);

/** "Order a replacement" from a public passport: creates a build, a part and a quote. */
export const REPLACEMENT_RATE_LIMIT = { perIp: 6, global: 120 } as const;
export const replacementLimiter = limiter('passport_replacement', REPLACEMENT_RATE_LIMIT.perIp, REPLACEMENT_RATE_LIMIT.global);

/** Hash of the guest device cookie (`dm_device`), exactly as the accounts module stores it. */
export const deviceHashFrom = (request: Request): string | null => getDeviceHash(request);
