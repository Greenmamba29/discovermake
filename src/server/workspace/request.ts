/**
 * Request helpers for the Build Workspace routes: per-IP rate limiters (same in-memory
 * fixed-window placeholder as the other R2 limits, see src/server/make-ai/rate-limit.ts)
 * and the guest device hash recorded on attachments.
 */
import { getDeviceHash } from '../auth/device';
import { FixedWindowRateLimiter, MakeAiRateLimiter } from '../make-ai/rate-limit';

const limiter = (perIp: number, global: number) =>
    new MakeAiRateLimiter(new FixedWindowRateLimiter(perIp, 60_000), new FixedWindowRateLimiter(global, 60_000));

/** Ask Make AI: each ask is a paid model call. */
export const ASSISTANT_ASK_RATE_LIMIT = { perIp: 10, global: 120 } as const;
export const assistantAskLimiter = limiter(ASSISTANT_ASK_RATE_LIMIT.perIp, ASSISTANT_ASK_RATE_LIMIT.global);

/** Attachment create / complete / delete / use-as-part (one file is 2-3 requests). */
export const ATTACHMENT_WRITE_RATE_LIMIT = { perIp: 60, global: 1200 } as const;
export const attachmentWriteLimiter = limiter(ATTACHMENT_WRITE_RATE_LIMIT.perIp, ATTACHMENT_WRITE_RATE_LIMIT.global);

/** "Order a replacement" from a public passport: creates a build, a part and a quote. */
export const REPLACEMENT_RATE_LIMIT = { perIp: 6, global: 120 } as const;
export const replacementLimiter = limiter(REPLACEMENT_RATE_LIMIT.perIp, REPLACEMENT_RATE_LIMIT.global);

/** Hash of the guest device cookie (`dm_device`), exactly as the accounts module stores it. */
export const deviceHashFrom = (request: Request): string | null => getDeviceHash(request);
