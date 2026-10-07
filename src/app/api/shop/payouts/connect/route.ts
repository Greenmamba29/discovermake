/**
 * POST /api/shop/payouts/connect -> ShopConnectLinkResponse
 * Auth: shop session. Creates the shop's Stripe Connect Express account on first use
 * (`shop.connect_account_created`), then returns a fresh hosted onboarding link.
 * 503 "Stripe is not configured" without STRIPE_SECRET_KEY.
 */
import { z } from 'zod';
import type { ShopConnectLinkResponse } from '@/contracts/connect';
import { ApiError, json, readBodyText, route } from '@/server/http';
import { assertSameOrigin, requireShop } from '@/server/shops';
import { createShopOnboardingLink } from '@/server/shops/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** No input: the shop comes from the session. An optional body must be an empty JSON object. */
const Body = z.object({}).strict();

export const POST = route(async (request) => {
    assertSameOrigin(request);
    const shop = await requireShop(request);
    const text = (await readBodyText(request, 1024)).trim();
    if (text) {
        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch {
            throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON');
        }
        Body.parse(raw);
    }
    const { url } = await createShopOnboardingLink(shop.shopId, { kind: 'shop', id: shop.shopId });
    return json<ShopConnectLinkResponse>({ url });
});
