/**
 * GET /api/live/auctions/:auctionId -> AuctionView (public; the viewer's own bid when signed in).
 * Closes the auction lazily when it is past its end.
 */
import { AuctionId, type AuctionView } from '@/contracts/live';
import { getViewer } from '@/server/auth/viewer';
import { ApiError, json, route } from '@/server/http';
import { getAuctionView } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ auctionId: string }>(async (request, { params }) => {
    const auctionId = pathId((await params).auctionId, AuctionId, 'Auction');
    const viewer = await getViewer(request);
    const view = await getAuctionView(auctionId, viewer?.user.id ?? null);
    if (!view) throw new ApiError('NOT_FOUND', 'Auction not found');
    return json<AuctionView>(view);
});
