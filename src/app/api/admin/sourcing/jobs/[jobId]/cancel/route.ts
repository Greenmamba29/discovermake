/** POST /api/admin/sourcing/jobs/:jobId/cancel  { reason? } -> SourcingJobView. Ends any lease and cancels pending approvals. Auth: Bearer ADMIN_TOKEN. */
import { SourcingJobId } from '@/contracts/common';
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { pathId, readJsonBody, validate } from '@/server/quote/route-helpers';
import { CancelSourcingJobRequest } from '@/server/sourcing/desk';
import { cancelJob, getJobView } from '@/server/sourcing/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ jobId: string }>(async (request, { params }) => {
    await requireAdmin(request);
    const jobId = pathId((await params).jobId, SourcingJobId, 'Sourcing job');
    const body = validate(await readJsonBody(request, { allowEmpty: true }), CancelSourcingJobRequest);
    await cancelJob(jobId, ADMIN_ACTOR, { reason: body.reason });
    return json(await getJobView(jobId));
});
