/**
 * GET /api/media/search?q=<text> -> SearchResponse (public): published builds, channels and clips
 * by Postgres full-text search (prefix matching; trigram fuzzy matching when pg_trgm is installed).
 */
import type { SearchResponse } from '@/contracts/media';
import { getViewer } from '@/server/auth/viewer';
import { json, route } from '@/server/http';
import { searchMedia } from '@/server/media';
import { limited, limitKey } from '@/server/media/http';
import { RateLimiter } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const searchLimiter = new RateLimiter('media_search', { kind: 'fixed_window', limit: 60, windowMs: 60_000 });

export const GET = route(async (request) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 100);
    const viewer = await getViewer(request);
    const tooFast = await limited(searchLimiter, limitKey(request, viewer?.user.id));
    if (tooFast) return tooFast;
    return json<SearchResponse>(await searchMedia(q, { viewerId: viewer?.user.id ?? null }));
});
