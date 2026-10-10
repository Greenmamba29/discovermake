/**
 * POST /api/passport/:passportId/replacement  { quantity?: 1..100 } -> ReplacementResponse (201), public.
 *
 * "Order a replacement" (1000-3): a new quote for the same part design as the passport (same
 * verified file, material, thickness, finish and operations; quantity 1 by default) through the
 * R1 quote engine. Needs only the public passport id (the signed link): no order token, no
 * buyer data in or out. The replacement part is a copy on a fresh build, so nothing private about
 * the original order is reachable. Per-IP rate limited; body cap 1 KB.
 * 404 unknown / inactive passport, 409 signature mismatch or original file unavailable.
 */
import { PassportId } from '@/contracts/common';
import { ReplacementRequest } from '@/contracts/workspace';
import { limitWrite } from '@/server/build-graph';
import { ApiError, json, readBodyText, route } from '@/server/http';
import { createReplacementQuote } from '@/server/passport/replacement';
import { pathId, validate } from '@/server/quote/route-helpers';
import { deviceHashFrom, replacementLimiter } from '@/server/workspace/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 1024;

export const POST = route<{ passportId: string }>(async (request, { params }) => {
    const passportId = pathId((await params).passportId, PassportId, 'Passport');
    const limited = await limitWrite(request, replacementLimiter, 'Too many replacement requests. Wait a minute and try again.');
    if (limited) return limited;
    const text = await readBodyText(request, MAX_BODY_BYTES);
    let raw: unknown = {};
    if (text.trim()) {
        try {
            raw = JSON.parse(text);
        } catch {
            throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON');
        }
    }
    const body = validate(raw, ReplacementRequest);
    return json(await createReplacementQuote(passportId, { quantity: body.quantity, deviceHash: deviceHashFrom(request) }), { status: 201 });
});

