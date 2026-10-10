/**
 * POST /api/reconstruct/:buildId/segment  SegmentRequest -> SegmentResponse
 *
 * Optional GPU auto-detect (RECONSTRUCT_WORKER_URL): object masks, the reference object and
 * SUGGESTED dimensions for one photo. 501 when no worker is configured. Suggestions only
 * prefill estimates; the caliper confirmation rule is unchanged.
 */
import { SegmentRequest } from '@/contracts/reconstruct';
import { limitWrite } from '@/server/build-graph';
import { json, parseJson, route } from '@/server/http';
import { reconstructBuildId, reconstructSegmentLimiter, requireOwnedReconstruct } from '@/server/reconstruct/request';
import { segmentAndMeasure } from '@/server/reconstruct/segmentation';
import { photoBytes } from '@/server/reconstruct/sessions';
import { assertNotKidMode } from '@/server/kids/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    await assertNotKidMode(request);
    const buildId = reconstructBuildId((await params).buildId);
    const limited = await limitWrite(request, reconstructSegmentLimiter, 'Too many auto-detect runs. Wait a minute and try again.');
    if (limited) return limited;
    const body = await parseJson(request, SegmentRequest, 2 * 1024);
    await requireOwnedReconstruct(request, buildId);
    const image = await photoBytes(buildId, body.attachmentId);
    return json(await segmentAndMeasure(image, { hint: body.hint }));
});
