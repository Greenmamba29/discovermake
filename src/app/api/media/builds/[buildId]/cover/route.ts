/**
 * GET /api/media/builds/:buildId/cover -> the cover image of a PUBLIC build (cached for an hour).
 * Only the verified image attachment the owner picked as the cover is ever served; 404 otherwise.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { BuildId } from '@/contracts/common';
import { getDb } from '@/server/db';
import { buildAttachments } from '@/server/db/schema';
import { ApiError, route } from '@/server/http';
import { loadPublication } from '@/server/media';
import { pathId } from '@/server/quote/route-helpers';
import { getStorage } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_IMAGE = /^image\/(png|jpeg|webp|gif|avif)$/;

export const GET = route<{ buildId: string }>(async (_request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const pub = await loadPublication(buildId);
    if (!pub || pub.visibility !== 'public' || !pub.coverAttachmentId) throw new ApiError('NOT_FOUND', 'Cover not found');
    const [att] = await getDb()
        .select()
        .from(buildAttachments)
        .where(and(eq(buildAttachments.id, pub.coverAttachmentId), eq(buildAttachments.buildId, buildId), isNull(buildAttachments.deletedAt)));
    if (!att || att.kind !== 'image' || !att.sha256 || !SAFE_IMAGE.test(att.contentType)) throw new ApiError('NOT_FOUND', 'Cover not found');
    const bytes = await getStorage().getObject(att.storageKey);
    if (!bytes) throw new ApiError('NOT_FOUND', 'Cover not found');
    return new Response(new Uint8Array(bytes), {
        headers: {
            'content-type': att.contentType,
            'cache-control': 'public, max-age=3600',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'",
        },
    });
});
