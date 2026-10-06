/**
 * Stripe Connect onboarding for partner shops (shop payouts).
 *
 *   POST /api/shop/payouts/connect          (shop session)   -> ShopConnectLinkResponse
 *   GET  /api/shop/payouts/status           (shop session)   -> ShopPayoutStatusResponse
 *   POST /api/admin/shops/:shopId/connect   (Bearer ADMIN)   -> AdminShopConnectLinkResponse
 *   POST /api/webhooks/stripe-connect       (Stripe signed)  -> { received: true }
 *
 * Every endpoint answers 503 "Stripe is not configured" when STRIPE_SECRET_KEY is unset;
 * manual payouts recorded by ops keep working without Stripe.
 */
import { z } from 'zod';

/** Where `/shop/payouts` was reached from: back from Stripe (`return`) or an expired link (`refresh`). */
export const ShopPayoutsReturnStatus = z.enum(['return', 'refresh']);
export type ShopPayoutsReturnStatus = z.infer<typeof ShopPayoutsReturnStatus>;

/** Hosted Stripe onboarding link (single use, expires after a few minutes). */
export const ShopConnectLinkResponse = z.object({ url: z.string().url() });
export type ShopConnectLinkResponse = z.infer<typeof ShopConnectLinkResponse>;

export const AdminShopConnectLinkResponse = ShopConnectLinkResponse.extend({
    accountId: z.string().min(1),
    /** True when this call created the shop's Express account. */
    created: z.boolean(),
});
export type AdminShopConnectLinkResponse = z.infer<typeof AdminShopConnectLinkResponse>;

export const ShopPayoutStatusResponse = z.discriminatedUnion('connected', [
    z.object({ connected: z.literal(false) }),
    z.object({
        connected: z.literal(true),
        chargesEnabled: z.boolean(),
        payoutsEnabled: z.boolean(),
        detailsSubmitted: z.boolean(),
    }),
]);
export type ShopPayoutStatusResponse = z.infer<typeof ShopPayoutStatusResponse>;
