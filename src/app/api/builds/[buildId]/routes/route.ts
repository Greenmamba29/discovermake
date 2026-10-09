/**
 * GET /api/builds/:buildId/routes?quote=<quoteId> -> RouteComparisonView
 * Manufacturing Route comparison (Suppliers · Processes · Impact): partner shops and supplier
 * offers scored on cost, P90 arrival, quality and CO₂, one Recommended. Buyer-safe.
 */
import { z } from 'zod';
import { BuildId, QuoteId } from '@/contracts/common';
import { json, parseQuery, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { compareRoutes } from '@/server/routing/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({ quote: QuoteId });

export const GET = route<{ buildId: string }>(async (request, { params }) => {
    const buildId = pathId((await params).buildId, BuildId, 'Build');
    const { quote } = parseQuery(request, Query);
    return json(await compareRoutes(buildId, quote));
});
