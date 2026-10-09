/**
 * Browser client for the R3 Prime experience routes (contracts in src/contracts/prime.ts).
 * Never sends amounts: ids, kinds and buyer details only.
 */
import type {
    AddressCheckRequest,
    AddressCheckResponse,
    AdminPrimeQueueResponse,
    CartCheckoutRequest,
    CartCheckoutResponse,
    CartView,
    CheckoutPreviewResponse,
    HoldRequestView,
    ImageUploadResponse,
    InvoiceCheckoutRequest,
    InvoiceView,
    MembershipResponse,
    OrderChatView,
    OrderRatingResponse,
    PostMessageRequest,
    PrimePlan,
    RatingView,
    ShopJobFlagsResponse,
    StartMembershipResponse,
    SubmitRatingRequest,
    TrackingMapView,
    UpsellKind,
    UpsellsResponse,
} from '@/contracts/prime';
import type { ShippingMethod } from '@/contracts/enums';
import { ORDER_TOKEN_HEADER } from '@/contracts/orders';
import { apiFetch, putSigned } from '@/lib/api';

const enc = encodeURIComponent;
const tok = (token: string | null) => (token ? { [ORDER_TOKEN_HEADER]: token } : undefined);
const admin = (token: string) => ({ authorization: `Bearer ${token}` });

/** Fired on window whenever the cart changes so the floating pill refreshes. */
export const CART_CHANGED_EVENT = 'dm:cart-changed';
export function announceCartChange(cart?: CartView) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: cart }));
}

export const primeApi = {
    membership: () => apiFetch<MembershipResponse>('/api/me/membership'),
    startMembership: (plan: PrimePlan) => apiFetch<StartMembershipResponse>('/api/me/membership', { body: { plan } }),
    updateMembership: (action: 'cancel' | 'resume') => apiFetch<MembershipResponse>('/api/me/membership', { method: 'PATCH', body: { action } }),

    cart: () => apiFetch<CartView>('/api/me/cart'),
    addToCart: async (quoteId: string, upsell?: UpsellKind) => {
        const cart = await apiFetch<CartView>('/api/me/cart/items', { body: { quoteId, ...(upsell ? { upsell } : {}) } });
        announceCartChange(cart);
        return cart;
    },
    removeFromCart: async (itemId: string) => {
        const cart = await apiFetch<CartView>(`/api/me/cart/items/${enc(itemId)}`, { method: 'DELETE' });
        announceCartChange(cart);
        return cart;
    },
    applyUpsell: async (itemId: string, kind: UpsellKind) => {
        const cart = await apiFetch<CartView>(`/api/me/cart/items/${enc(itemId)}/upsell`, { body: { kind } });
        announceCartChange(cart);
        return cart;
    },
    upsells: (quoteId: string) => apiFetch<UpsellsResponse>(`/api/me/cart/upsells?quoteId=${enc(quoteId)}`),
    cartPreview: (shippingMethod: ShippingMethod) => apiFetch<CheckoutPreviewResponse>('/api/me/cart/preview', { body: { shippingMethod } }),
    cartCheckout: (body: CartCheckoutRequest) => apiFetch<CartCheckoutResponse>('/api/me/cart/checkout', { body }),

    checkoutPreview: (quoteId: string, shippingMethod: ShippingMethod) => apiFetch<CheckoutPreviewResponse>('/api/checkout/preview', { body: { quoteId, shippingMethod } }),
    checkAddress: (body: AddressCheckRequest) => apiFetch<AddressCheckResponse>('/api/checkout/address', { body }),
    invoiceCheckout: (body: InvoiceCheckoutRequest) => apiFetch<CartCheckoutResponse>('/api/checkout/invoice', { body }),

    trackingMap: (orderId: string, token: string | null) => apiFetch<TrackingMapView>(`/api/orders/${enc(orderId)}/tracking-map`, { headers: tok(token) }),
    chat: (orderId: string, token: string | null) => apiFetch<OrderChatView>(`/api/orders/${enc(orderId)}/messages`, { headers: tok(token) }),
    postChat: (orderId: string, token: string | null, body: PostMessageRequest) => apiFetch<OrderChatView>(`/api/orders/${enc(orderId)}/messages`, { body, headers: tok(token) }),
    chatUpload: (orderId: string, token: string | null, file: File) => uploadImage(`/api/orders/${enc(orderId)}/messages/upload`, file, tok(token)),
    rating: (orderId: string, token: string | null) => apiFetch<OrderRatingResponse>(`/api/orders/${enc(orderId)}/rating`, { headers: tok(token) }),
    submitRating: (orderId: string, token: string | null, body: SubmitRatingRequest) => apiFetch<OrderRatingResponse>(`/api/orders/${enc(orderId)}/rating`, { body, headers: tok(token) }),
    ratingUpload: (orderId: string, token: string | null, file: File) => uploadImage(`/api/orders/${enc(orderId)}/rating/upload`, file, tok(token)),

    shopChat: (jobId: string) => apiFetch<OrderChatView>(`/api/shop/jobs/${enc(jobId)}/messages`),
    shopPostChat: (jobId: string, body: PostMessageRequest) => apiFetch<OrderChatView>(`/api/shop/jobs/${enc(jobId)}/messages`, { body }),
    shopChatUpload: (jobId: string, file: File) => uploadImage(`/api/shop/jobs/${enc(jobId)}/messages/upload`, file),
    shopFlags: () => apiFetch<ShopJobFlagsResponse>('/api/shop/flags'),

    adminQueue: (token: string) => apiFetch<AdminPrimeQueueResponse>('/api/admin/prime', { headers: admin(token) }),
    adminModerate: (token: string, ratingId: string, decision: 'approve' | 'reject', reason?: string) =>
        apiFetch<RatingView>(`/api/admin/prime/ratings/${enc(ratingId)}`, { body: { decision, ...(reason ? { reason } : {}) }, headers: admin(token) }),
    adminResolveHold: (token: string, holdId: string, decision: 'acknowledge' | 'decline', note?: string) =>
        apiFetch<HoldRequestView>(`/api/admin/prime/holds/${enc(holdId)}`, { body: { decision, ...(note ? { note } : {}) }, headers: admin(token) }),
    adminMarkWire: (token: string, invoiceId: string, reference: string) => apiFetch<InvoiceView>(`/api/admin/prime/invoices/${enc(invoiceId)}/wire`, { body: { reference }, headers: admin(token) }),
    adminChat: (token: string, orderId: string) => apiFetch<OrderChatView>(`/api/admin/prime/orders/${enc(orderId)}/messages`, { headers: admin(token) }),
    adminPostChat: (token: string, orderId: string, body: PostMessageRequest) => apiFetch<OrderChatView>(`/api/admin/prime/orders/${enc(orderId)}/messages`, { body, headers: admin(token) }),
};

/** Signed image upload: ask the route for a target, PUT the bytes, return the key. */
async function uploadImage(path: string, file: File, headers?: Record<string, string>): Promise<string> {
    const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
    const target = await apiFetch<ImageUploadResponse>(path, { body: { contentType: type, sizeBytes: file.size }, headers });
    await putSigned(target.upload, file);
    return target.key;
}
