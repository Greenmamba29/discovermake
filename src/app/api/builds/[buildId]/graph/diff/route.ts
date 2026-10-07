/**
 * GET /api/builds/:buildId/graph/diff?from=A&to=B -> BuildGraphDiff (public).
 * Compares two design versions by stable node key: added / removed keys, changed
 * top-level `data` fields + label, and edge counts.
 */
import { z } from 'zod';
import { BuildId } from '@/contracts';
import { diffVersions } from '@/server/build-graph';
import { json, parseQuery, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DiffQuery = z.object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() });

export const GET = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const { from, to } = parseQuery(request, DiffQuery);
    return json(await diffVersions(buildId, from, to));
});
