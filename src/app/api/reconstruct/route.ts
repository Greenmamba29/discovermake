/**
 * POST /api/reconstruct  CreateReconstructRequest -> CreateReconstructResponse (201)
 *
 * R6 Reconstruct: starts a build (origin 'reconstruct') for a broken part, optionally linked to
 * a Product Passport (material / process prefilled from its PUBLIC snapshot). Photos are then
 * uploaded with the attachment routes. The build belongs to the signed-in user and/or this
 * device (ADR-0009). Per-IP rate limited (shared store). Emits `build.created`,
 * `design.version_created`, `reconstruct.started`.
 */
import { CreateReconstructRequest } from '@/contracts/reconstruct';
import { assertSameOrigin, resolveBuildOwner } from '@/server/auth/viewer';
import { limitWrite } from '@/server/build-graph';
import { json, parseJson, route } from '@/server/http';
import { reconstructWriteLimiter } from '@/server/reconstruct/request';
import { createReconstruct } from '@/server/reconstruct/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const limited = await limitWrite(request, reconstructWriteLimiter, 'Too many requests in a short time. Wait a minute and try again.');
    if (limited) return limited;
    const body = await parseJson(request, CreateReconstructRequest, 8 * 1024);
    const owner = await resolveBuildOwner(request);
    const result = await createReconstruct(body, { ownerUserId: owner.ownerUserId, deviceHash: owner.deviceHash });
    const res = json(result, { status: 201 });
    owner.apply(res);
    return res;
});
