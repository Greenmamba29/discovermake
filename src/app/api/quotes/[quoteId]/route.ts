/**
 * GET /api/quotes/:quoteId -> QuoteView (public; ids are unguessable).
 * `orderable` and EXPIRED status are evaluated at read time.
 */
import { QuoteId } from '@/contracts';
import { ApiError, json, route } from '@/server/http';
import { getQuote } from '@/server/quote';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ quoteId: string }>(async (_request, { params }) => {
    const quoteId = pathId((await params).quoteId, QuoteId, 'Quote');
    const quote = await getQuote(quoteId);
    if (!quote) throw new ApiError('NOT_FOUND', 'Quote not found');
    return json(quote);
});
