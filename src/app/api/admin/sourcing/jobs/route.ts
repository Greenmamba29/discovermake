/**
 * GET  /api/admin/sourcing/jobs?status=QUEUED,LEASED&channel=desk&buildId=bld_... -> SourcingJobView[]
 * POST /api/admin/sourcing/jobs  CreateSourcingRequest & { buildId, channel? } -> SourcingJobView (201)
 * Ops/desk view of the sourcing queue. Auth: Bearer ADMIN_TOKEN.
 */
import { ADMIN_ACTOR, requireAdmin } from '@/server/auth/admin';
import { json, parseJson, parseQuery, route } from '@/server/http';
import { AdminCreateSourcingJobRequest, ListSourcingJobsQuery } from '@/server/sourcing/desk';
import { createSourcingJob, getJobView, listJobs } from '@/server/sourcing/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    requireAdmin(request);
    const q = parseQuery(request, ListSourcingJobsQuery);
    return json(await listJobs({ statuses: q.status, channel: q.channel, buildId: q.buildId }));
});

export const POST = route(async (request) => {
    requireAdmin(request);
    const { buildId, channel, ...body } = await parseJson(request, AdminCreateSourcingJobRequest);
    const { job } = await createSourcingJob({ ...body, buildId, channel, actor: ADMIN_ACTOR });
    return json(await getJobView(job.id), { status: 201 });
});
