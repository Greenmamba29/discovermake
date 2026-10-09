/**
 * POST /api/live/auctions/:auctionId/bids PlaceBidRequest -> PlaceBidResponse (201, signed in).
 *
 * Bid ladder (>= current + min increment), anti-snipe (+15 s for a bid in the last 10 s). The bid
 * is a LIVE_DROP order with an authorize-only hold (bid + shipping) that the bidder authorizes at
 * `checkoutUrl`; only authorized bids can win. Signed `auction.bid`; the previous leader is notified.
 */
import { AuctionId, PlaceBidRequest, type PlaceBidResponse } from '@/contracts/live';
import { assertSameOrigin, requireViewer } from '@/server/auth/viewer';
import { json, parseJson, route } from '@/server/http';
import { limitLive, placeBid } from '@/server/live';
import { pathId } from '@/server/quote/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ auctionId: string }>(async (request, { params }) => {
    assertSameOrigin(request);
    const auctionId = pathId((await params).auctionId, AuctionId, 'Auction');
    const viewer = await requireViewer(request);
    const tooFast = await limitLive('bid', viewer.user.id);
    if (tooFast) return tooFast;
    const body = await parseJson(request, PlaceBidRequest);
    return json<PlaceBidResponse>(await placeBid(auctionId, viewer, body), { status: 201 });
});
