/**
 * GET /api/me/cart/upsells?quoteId=qte_... -> UpsellsResponse
 * "Complete your build" offers for a binding quote, each priced by the quote engine.
 */
import { z } from 'zod';
import { QuoteId } from '@/contracts/common';
import type { UpsellsResponse } from '@/contracts/prime';
import { getUpsellOffers } from '@/server/cart/upsells';
import { json, parseQuery, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    const { quoteId } = parseQuery(request, z.object({ quoteId: QuoteId }));
    return json<UpsellsResponse>({ baseQuoteId: quoteId, offers: await getUpsellOffers(quoteId) });
});
