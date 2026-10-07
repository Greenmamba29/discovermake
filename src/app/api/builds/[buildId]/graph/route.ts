/**
 * GET /api/builds/:buildId/graph?version=N -> BuildGraphView (public; ids are unguessable, ADR-0008).
 * Defaults to the build's current version. 404 for an unknown build, a build without a
 * Build Graph (R1 upload builds) or an unknown version.
 */
import { z } from 'zod';
import { BuildId } from '@/contracts';
import { getGraph } from '@/server/build-graph';
import { ApiError, json, parseQuery, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GraphQuery = z.object({ version: z.coerce.number().int().positive().optional() });

export const GET = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const { version } = parseQuery(request, GraphQuery);
    const view = await getGraph(buildId, version);
    if (!view) throw new ApiError('NOT_FOUND', 'Build Graph not found');
    return json(view);
});
