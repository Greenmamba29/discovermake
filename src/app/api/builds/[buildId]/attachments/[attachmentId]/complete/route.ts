/**
 * POST /api/builds/:buildId/attachments/:attachmentId/complete -> BuildAttachmentView
 *
 * Verifies an uploaded attachment: the object exists, is within the size cap, and its magic
 * bytes match its extension. Records sha256 and emits `build.attachment_added`. A file that
 * fails is removed (413 too large, 415 wrong contents). Idempotent once verified.
 */
import { BuildAttachmentId, BuildId } from '@/contracts';
import { limitWrite } from '@/server/build-graph';
import { assertCanEditBuild } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { completeAttachment, requireBuild } from '@/server/workspace/attachments';
import { attachmentWriteLimiter } from '@/server/workspace/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Params = { buildId: string; attachmentId: string };

export const POST = route<Params>(async (request, { params }) => {
    const p = await params;
    const buildId = pathId(p.buildId, BuildId, 'Build');
    const attachmentId = pathId(p.attachmentId, BuildAttachmentId, 'Attachment');
    const limited = limitWrite(request, attachmentWriteLimiter, 'Too many uploads in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    return json(await completeAttachment(buildId, attachmentId));
});
