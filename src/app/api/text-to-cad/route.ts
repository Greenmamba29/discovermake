/**
 * GET  /api/text-to-cad           -> MakeIt3dAvailability (always 200; the /make/ai entry shows an honest unavailable state)
 * POST /api/text-to-cad {prompt}  -> CreateMakeIt3dBuildResponse (201)
 *
 * "Make it in 3D" from /make/ai: starts a build (version 1 = the buyer's description) owned by the
 * signed-in user and/or this device (ADR-0009). The page then calls
 * POST /api/builds/:buildId/text-to-cad with the same description. Refuses (503) when Make AI or
 * the CAD worker is unavailable, so no empty build is left behind. Per-IP rate limited.
 */
import { MakeIt3dRequest, type MakeIt3dAvailability } from '@/contracts/make-it-3d';
import { assertSameOrigin, resolveBuildOwner } from '@/server/auth/viewer';
import { limitWrite } from '@/server/build-graph';
import { ApiError, json, parseJson, route } from '@/server/http';
import { createMakeIt3dBuild, makeIt3dAvailability } from '@/server/text-to-cad/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => json<MakeIt3dAvailability>(makeIt3dAvailability()));

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const limited = await limitWrite(request);
    if (limited) return limited;
    const body = await parseJson(request, MakeIt3dRequest, 8 * 1024);
    const availability = makeIt3dAvailability();
    if (!availability.available) throw new ApiError('INTERNAL', availability.reason ?? 'Make it in 3D is not available right now.', 503);
    const owner = await resolveBuildOwner(request);
    const res = json(await createMakeIt3dBuild(body.prompt, { ownerUserId: owner.ownerUserId, deviceHash: owner.deviceHash }), { status: 201 });
    owner.apply(res);
    return res;
});
