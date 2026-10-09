/**
 * GET  /api/builds/:buildId/assistant  -> AssistantStatus (always 200: the panel shows an honest unavailable state)
 * POST /api/builds/:buildId/assistant  AssistantRequest
 *   { action: 'ask', message }                          -> AssistantAskResponse (200; `unavailable` when Make AI is off)
 *   { action: 'confirm', basedOnVersion, proposal }     -> BuildGraphView (201, a NEW design version)
 *   { action: 'add_requirement', basedOnVersion, text } -> BuildGraphView (201, works with Make AI off)
 *
 * Ask Make AI (300-3), scoped to the build's latest design version. Asks never write; only a
 * confirmation does, through the Build Graph services. Body cap 16 KB. Per-IP rate limits:
 * asks share a model budget, confirmations use the Build Graph write limiter. Writes go through
 * `assertCanEditBuild`. 409 when the proposal's version is no longer the latest.
 */
import { BuildId } from '@/contracts';
import { AssistantRequest, ASSISTANT_MAX_BODY_BYTES, type AssistantStatus } from '@/contracts/workspace';
import { getGraph, limitWrite } from '@/server/build-graph';
import { assertCanEditBuild } from '@/server/auth/viewer';
import { ApiError, json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { requireBuild } from '@/server/workspace/attachments';
import { addRequirement, askAssistant, assistantAvailability, confirmProposal } from '@/server/workspace/assistant';
import { assistantAskLimiter } from '@/server/workspace/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = route<{ buildId: string }>(async (_request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const view = await getGraph(buildId);
    if (!view) throw new ApiError('NOT_FOUND', 'This build has no Build Graph yet');
    const { available, reason } = assistantAvailability();
    return json<AssistantStatus>({ available, reason, version: view.version.version });
});

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const body = await parseJson(request, AssistantRequest, ASSISTANT_MAX_BODY_BYTES);
    if (body.action === 'ask') {
        const limited = limitWrite(request, assistantAskLimiter, 'Make AI is getting a lot of questions from you. Wait a minute and ask again.');
        if (limited) return limited;
        return json(await askAssistant(buildId, body.message));
    }
    const limited = limitWrite(request);
    if (limited) return limited;
    const build = await requireBuild(buildId);
    await assertCanEditBuild(request, build);
    const view =
        body.action === 'confirm'
            ? await confirmProposal(buildId, body.basedOnVersion, body.proposal)
            : await addRequirement(buildId, body.basedOnVersion, body.text, body.category, { via: 'buyer' });
    return json(view, { status: 201 });
});
