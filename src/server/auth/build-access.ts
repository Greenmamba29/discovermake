/**
 * Route-level build guards (ADR-0009): load the owner columns and apply
 * `assertCanEditBuild`. A missing build is 404 (same as before), so ids stay the only
 * thing that tells builds apart.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { builds, parts } from '../db/schema';
import { ApiError } from '../http';
import { assertCanEditBuild, type BuildOwnership } from './viewer';

export async function loadBuildOwnership(buildId: string): Promise<BuildOwnership | null> {
    const [row] = await getDb().select({ id: builds.id, ownerUserId: builds.ownerUserId, deviceHash: builds.deviceHash }).from(builds).where(eq(builds.id, buildId));
    return row ?? null;
}

/** 404 unknown build, 403 unless the caller may change it. */
export async function assertCanEditBuildId(request: Request, buildId: string): Promise<void> {
    const build = await loadBuildOwnership(buildId);
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    await assertCanEditBuild(request, build);
}

/** Same guard for part routes (upload, analyze): the part's build decides. */
export async function assertCanEditPart(request: Request, partId: string): Promise<void> {
    const [row] = await getDb()
        .select({ id: builds.id, ownerUserId: builds.ownerUserId, deviceHash: builds.deviceHash })
        .from(parts)
        .innerJoin(builds, eq(builds.id, parts.buildId))
        .where(eq(parts.id, partId));
    if (!row) throw new ApiError('NOT_FOUND', 'Part not found');
    await assertCanEditBuild(request, row);
}
