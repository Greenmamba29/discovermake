/**
 * POST /api/builds/:buildId/attachments/:attachmentId/use-as-part -> UseAttachmentAsPartResponse (201)
 *
 * Runs a DXF attachment through the R1 analyze -> instant quote flow: the bytes become a part
 * on the same build, analyzed like an upload, and the buyer continues on `/parts/:partId`.
 * Once per attachment (later calls return the same part). 415 for non-DXF or binary DXF.
 */
import { BuildAttachmentId, BuildId } from '@/contracts';
import { limitWrite } from '@/server/build-graph';
import { assertCanEditBuild } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { requireBuild, useAttachmentAsPart } from '@/server/workspace/attachments';
import { attachmentWriteLimiter } from '@/server/workspace/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Large DXFs can take a few seconds to parse. */
export const maxDuration = 60;

type Params = { buildId: string; attachmentId: string };

export const POST = route<Params>(async (request, { params }) => {
    const p = await params;
    const buildId = pathId(p.buildId, BuildId, 'Build');
    const attachmentId = pathId(p.attachmentId, BuildAttachmentId, 'Attachment');
    const limited = await limitWrite(request, attachmentWriteLimiter, 'Too many requests in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    return json(await useAttachmentAsPart(buildId, attachmentId), { status: 201 });
});
