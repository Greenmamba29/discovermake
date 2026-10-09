/**
 * Reconstruct route helpers: shared-store rate limiters (src/server/rate-limit RateLimiter:
 * Postgres in production, memory elsewhere) and the owner check every write goes through.
 * Photo uploads use the attachment routes and their limiter (attachmentWriteLimiter).
 */
import 'server-only';
import { BuildId } from '@/contracts';
import { assertCanEditBuild, canEditBuild, getDeviceHash, getViewer } from '@/server/auth/viewer';
import { ApiError } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { CompositeRateLimiter, RateLimiter } from '@/server/rate-limit';
import { requireBuild } from '@/server/workspace/attachments';

const limiter = (name: string, perIp: number, global: number) =>
    new CompositeRateLimiter(
        new RateLimiter(`${name}_ip`, { kind: 'fixed_window', limit: perIp, windowMs: 60_000 }),
        new RateLimiter(`${name}_global`, { kind: 'fixed_window', limit: global, windowMs: 60_000 }),
    );

/** Session writes: create, choices, measurements, caliper confirmations. */
export const RECONSTRUCT_WRITE_RATE_LIMIT = { perIp: 60, global: 1200 } as const;
export const reconstructWriteLimiter = limiter('reconstruct_write', RECONSTRUCT_WRITE_RATE_LIMIT.perIp, RECONSTRUCT_WRITE_RATE_LIMIT.global);
/** CAD generation and print quotes (a worker run or a priced snapshot each). */
export const RECONSTRUCT_GENERATE_RATE_LIMIT = { perIp: 10, global: 200 } as const;
export const reconstructGenerateLimiter = limiter('reconstruct_generate', RECONSTRUCT_GENERATE_RATE_LIMIT.perIp, RECONSTRUCT_GENERATE_RATE_LIMIT.global);
/** GPU auto-detect (each call is a paid GPU job). */
export const RECONSTRUCT_SEGMENT_RATE_LIMIT = { perIp: 6, global: 60 } as const;
export const reconstructSegmentLimiter = limiter('reconstruct_segment', RECONSTRUCT_SEGMENT_RATE_LIMIT.perIp, RECONSTRUCT_SEGMENT_RATE_LIMIT.global);

export function reconstructBuildId(raw: string): string {
    return pathId(raw, BuildId, 'Build');
}

/** 404 unless the build is a Reconstruct build; 403 unless the caller owns it (assertCanEditBuild). */
export async function requireOwnedReconstruct(request: Request, buildId: string) {
    const build = await requireBuild(buildId);
    if (build.origin !== 'reconstruct') throw new ApiError('NOT_FOUND', 'Reconstruct session not found');
    await assertCanEditBuild(request, build);
    return { build, owner: { ownerUserId: build.ownerUserId, deviceHash: build.deviceHash } };
}

export async function canEditReconstruct(request: Request, buildId: string): Promise<boolean> {
    const build = await requireBuild(buildId);
    if (build.origin !== 'reconstruct') throw new ApiError('NOT_FOUND', 'Reconstruct session not found');
    return canEditBuild({ viewer: await getViewer(request), deviceHash: getDeviceHash(request) }, build);
}
