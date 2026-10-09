/**
 * Browser client for the R3 Prime routes (supplier quotes, route comparison, balance, receiving,
 * shop stock, supplier legs). Same error handling as `api` (ApiClientError).
 */
import type {
    AdvanceSupplierLegRequest,
    BalancePaymentView,
    QuoteView,
    RouteComparisonView,
    ShopJobDetail,
    ShopStockView,
    SupplierLegOpsView,
    UpsertShopStockRequest,
} from '@/contracts';
import { ORDER_TOKEN_HEADER } from '@/contracts/orders';
import { apiFetch } from './api';

const enc = encodeURIComponent;

export const primeApi = {
    supplierQuote: (buildId: string, offerId: string) => apiFetch<QuoteView>(`/api/builds/${enc(buildId)}/sourcing/offers/${enc(offerId)}/quote`, { method: 'POST' }),
    routes: (buildId: string, quoteId: string) => apiFetch<RouteComparisonView>(`/api/builds/${enc(buildId)}/routes?quote=${enc(quoteId)}`),
    requestBalance: (orderId: string, token: string) => apiFetch<BalancePaymentView>(`/api/orders/${enc(orderId)}/balance`, { method: 'POST', headers: { [ORDER_TOKEN_HEADER]: token } }),
    receiveFreight: (jobId: string, note?: string) => apiFetch<ShopJobDetail>(`/api/shop/jobs/${enc(jobId)}/receive`, { body: note ? { note } : {} }),
    shopStock: () => apiFetch<{ stock: ShopStockView[] }>('/api/shop/stock'),
    upsertStock: (body: UpsertShopStockRequest) => apiFetch<ShopStockView>('/api/shop/stock', { body }),
    updateStock: (stockId: string, quantity: number) => apiFetch<ShopStockView>(`/api/shop/stock/${enc(stockId)}`, { method: 'PATCH', body: { quantity } }),
    advanceLeg: (token: string, legId: string, body: AdvanceSupplierLegRequest) =>
        apiFetch<SupplierLegOpsView>(`/api/admin/supplier-legs/${enc(legId)}/advance`, { body, headers: { authorization: `Bearer ${token}` } }),
};
