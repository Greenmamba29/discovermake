/** Follow / unfollow a build (signed in). Following is a read relationship: it grants no edit rights. */
import { and, eq } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../db';
import { buildFollows, builds } from '../db/schema';
import { ApiError } from '../http';

export async function setFollow(userId: string, buildId: string, following: boolean, db: DbOrTx = getDb()): Promise<{ following: boolean }> {
    const [build] = await db.select({ id: builds.id }).from(builds).where(eq(builds.id, buildId));
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    if (following) {
        await db.insert(buildFollows).values({ userId, buildId }).onConflictDoNothing();
    } else {
        await db.delete(buildFollows).where(and(eq(buildFollows.userId, userId), eq(buildFollows.buildId, buildId)));
    }
    return { following };
}
