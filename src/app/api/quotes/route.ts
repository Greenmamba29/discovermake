/**
 * POST /api/quotes  CreateQuoteRequest -> QuoteView (201), public.
 *
 * The client sends ids + quantity only; every amount is computed server-side.
 * Blocking DFM returns a persisted NEEDS_INPUT quote (orderable=false) so the UI
 * can show inline fixes; only READY + BINDING quotes are orderable.
 */
import { CreateQuoteRequest } from '@/contracts';
import { json, route } from '@/server/http';
import { createQuote } from '@/server/quote';
import { readJsonBody, validate } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
    const body = validate(await readJsonBody(request), CreateQuoteRequest);
    return json(await createQuote(body), { status: 201 });
});
