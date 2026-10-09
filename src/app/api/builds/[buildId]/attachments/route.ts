/**
 * GET  /api/builds/:buildId/attachments                          -> BuildAttachmentList (verified files, fresh signed URLs)
 * POST /api/builds/:buildId/attachments  CreateAttachmentRequest -> CreateAttachmentResponse (201)
 *
 * Attachment tray (100-1). POST checks the declared extension, content type and size
 * (images png/jpg/webp/heic up to 15 MB; CAD dxf/step/stp/stl/svg up to 50 MB) and returns a
 * signed PUT bound to that content type. The client then PUTs the bytes and calls
 * POST .../attachments/:attachmentId/complete, which verifies the bytes. Per-IP rate limited;
 * writes go through `assertCanEditBuild`.
 */
import { BuildId } from '@/contracts';
import { CreateAttachmentRequest } from '@/contracts/workspace';
import { limitWrite } from '@/server/build-graph';
import { assertCanEditBuild } from '@/server/auth/viewer';
import { json, MAX_JSON_BODY_BYTES, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { createAttachmentUpload, listAttachments, requireBuild } from '@/server/workspace/attachments';
import { attachmentWriteLimiter, deviceHashFrom } from '@/server/workspace/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ buildId: string }>(async (_request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    await requireBuild(buildId);
    return json(await listAttachments(buildId));
});

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const limited = await limitWrite(request, attachmentWriteLimiter, 'Too many uploads in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const body = await parseJson(request, CreateAttachmentRequest, MAX_JSON_BODY_BYTES);
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    return json(await createAttachmentUpload(build, body, { deviceHash: deviceHashFrom(request) }), { status: 201 });
});
