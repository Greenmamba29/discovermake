/**
 * POST /api/admin/sourcing/jobs/:jobId/requeue  { channel?: "accio" | "desk" } -> SourcingJobView
 * Puts the job back in the queue (ending any lease); `channel: "desk"` hands it to the
 * sourcing desk. 409 when the build moved to a newer design version. Auth: Bearer ADMIN_TOKEN.
 */
import { SourcingJobId } from '@/contracts/common';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { pathId, readJsonBody, validate } from '@/server/quote/route-helpers';
import { RequeueSourcingJobRequest } from '@/server/sourcing/desk';
import { getJobView, requeueJob } from '@/server/sourcing/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    await requireAdmin(request);
    const jobId = pathId((await params).jobId, SourcingJobId, 'Sourcing job');
    const body = validate(await readJsonBody(request, { allowEmpty: true }), RequeueSourcingJobRequest);
    await requeueJob(jobId, ADMIN_ACTOR, { channel: body.channel });
    return json(await getJobView(jobId));
});
