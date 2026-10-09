/**
 * POST /api/builds/:buildId/answers  { answers: [{ unknownKey, value }] } -> BuildGraphView (201), build owner only.
 *
 * Answers NEEDS_INPUT question cards. Writes a NEW design version: answered UNKNOWN nodes get
 * `status: "answered"` + the value, and a user-sourced REQUIREMENT is added per answer. When no
 * open questions remain the build moves to DRAFT. Per-IP rate limited.
 * 400 bad body / unknown question, 404 build or graph, 409 already answered.
 * 403 unless the caller may edit the build (owner, its device, or ops; ADR-0009).
 */
import { BuildId } from '@/contracts';
import { AnswersRequest, answerUnknowns, limitWrite } from '@/server/build-graph';
import { assertCanEditBuildId } from '@/server/auth/build-access';
import { json, MAX_JSON_BODY_BYTES, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const limited = limitWrite(request);
    if (limited) return limited;
    await assertCanEditBuildId(request, buildId);
    const body = await parseJson(request, AnswersRequest, MAX_JSON_BODY_BYTES);
    return json(await answerUnknowns(buildId, body.answers), { status: 201 });
});
