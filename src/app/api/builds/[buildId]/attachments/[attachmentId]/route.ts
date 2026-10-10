/**
 * DELETE /api/builds/:buildId/attachments/:attachmentId -> { ok: true }
 *
 * Removes a file from the tray (soft delete; the stored object is deleted). A part already
 * made from it keeps its own copy. Per-IP rate limited; goes through `assertCanEditBuild`.
 */
import { BuildAttachmentId, BuildId } from '@/contracts';
import { limitWrite } from '@/server/build-graph';
import { assertCanEditBuild } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { deleteAttachment, requireBuild } from '@/server/workspace/attachments';
import { attachmentWriteLimiter } from '@/server/workspace/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { buildId: string; attachmentId: string };

export const DELETE = route<Params>(async (request, { params }) => {
    const p = await params;
    const buildId = pathId(p.buildId, BuildId, 'Build');
    const attachmentId = pathId(p.attachmentId, BuildAttachmentId, 'Attachment');
    const limited = await limitWrite(request, attachmentWriteLimiter, 'Too many changes in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    await deleteAttachment(buildId, attachmentId);
    return json({ ok: true as const });
});
