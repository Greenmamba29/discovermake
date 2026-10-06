/**
 * Browser-side API client for the R1 routes (docs/architecture/r1-implementation.md §4).
 *
 * Every call goes to our own route handlers; the client never sends amounts,
 * only ids and buyer details. Non-2xx responses carry `ApiErrorBody` and are
 * surfaced as `ApiClientError` with the server's plain-language message.
 */
import type {
    AdminDispatchResponse,
    AdminOrderDetail,
    AdminOrderListResponse,
    AnalyzePartRequest,
    BuildView,
    CatalogResponse,
    CheckoutRequest,
    CheckoutResponse,
    CreatePartRequest,
    CreatePartResponse,
    CreateQuoteRequest,
    CreateShipmentRequest,
    DeclineJobRequest,
    DevPaymentConfirmRequest,
    DevPaymentConfirmResponse,
    InspectionResultView,
    InspectionSubmitRequest,
    MarkDeliveredRequest,
    MilestoneRequest,
    MilestoneView,
    OkResponse,
    OrderView,
    PartView,
    PassportPublicResponse,
    PassportVerifyResponse,
    QaUploadRequest,
    QaUploadResponse,
    QuoteView,
    ShipmentView,
    ShopJobDetail,
    ShopJobListResponse,
    ShopLoginRequest,
    ShopSessionResponse,
    JobStatus,
    OrderStatus,
} from '@/contracts';
import { ORDER_TOKEN_HEADER } from '@/contracts/orders';

export class ApiClientError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiClientError';
    }
}

type RequestOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
};

const FALLBACK_MESSAGES: Record<number, string> = {
    400: 'Some details need another look.',
    401: 'Please sign in again.',
    403: 'You do not have access to this.',
    404: 'We could not find that.',
    409: 'This changed in the meantime. Refresh and try again.',
    413: 'That file is too large.',
    429: 'Too many requests. Wait a moment and try again.',
};

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
        res = await fetch(path, {
            method: opts.method ?? (body ? 'POST' : 'GET'),
            headers,
            body,
            signal: opts.signal,
            credentials: 'same-origin',
            cache: 'no-store',
        });
    } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        throw new ApiClientError('Network problem. Check your connection and try again.', 0, 'NETWORK');
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }
    if (!res.ok) {
        const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
        throw new ApiClientError(
            err?.message || FALLBACK_MESSAGES[res.status] || 'Something went wrong on our side. Try again in a moment.',
            res.status,
            err?.code ?? 'INTERNAL',
            err?.details,
        );
    }
    return data as T;
}

export function errorMessage(err: unknown): string {
    if (err instanceof ApiClientError) return err.message;
    if (err instanceof Error && err.message) return err.message;
    return 'Something went wrong. Try again.';
}

const enc = encodeURIComponent;
const statusQuery = (status?: readonly string[]) => (status && status.length ? `?status=${status.map(enc).join(',')}` : '');

/** PUT raw bytes to a signed upload target with progress (XHR: fetch has no upload progress). */
export function putSigned(
    upload: { url: string; method: 'PUT'; headers: Record<string, string> },
    file: Blob,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(upload.method, upload.url, true);
        for (const [k, v] of Object.entries(upload.headers)) {
            // Browsers forbid setting these; they are derived from the body automatically.
            if (/^(content-length|host)$/i.test(k)) continue;
            xhr.setRequestHeader(k, v);
        }
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new ApiClientError(`Upload failed (HTTP ${xhr.status}).`, xhr.status, 'UPLOAD_FAILED'));
        };
        xhr.onerror = () => reject(new ApiClientError('Upload failed. Check your connection and try again.', 0, 'NETWORK'));
        xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(file);
    });
}

export const api = {
    // ---- quote ----
    catalog: () => apiFetch<CatalogResponse>('/api/catalog'),
    createPart: (body: CreatePartRequest) => apiFetch<CreatePartResponse>('/api/parts', { body }),
    getPart: (partId: string) => apiFetch<PartView>(`/api/parts/${enc(partId)}`),
    analyzePart: (partId: string, body: AnalyzePartRequest = {}) => apiFetch<PartView>(`/api/parts/${enc(partId)}/analyze`, { body }),
    getBuild: (buildId: string) => apiFetch<BuildView>(`/api/builds/${enc(buildId)}`),
    createQuote: (body: CreateQuoteRequest, signal?: AbortSignal) => apiFetch<QuoteView>('/api/quotes', { body, signal }),
    getQuote: (quoteId: string) => apiFetch<QuoteView>(`/api/quotes/${enc(quoteId)}`),

    // ---- orders ----
    checkout: (body: CheckoutRequest) => apiFetch<CheckoutResponse>('/api/checkout', { body }),
    devConfirm: (body: DevPaymentConfirmRequest) => apiFetch<DevPaymentConfirmResponse>('/api/checkout/dev-confirm', { body }),
    getOrder: (orderId: string, token: string) =>
        apiFetch<OrderView>(`/api/orders/${enc(orderId)}`, { headers: { [ORDER_TOKEN_HEADER]: token } }),

    // ---- passport ----
    getPassport: (id: string) => apiFetch<PassportPublicResponse>(`/api/passport/${enc(id)}`),
    verifyPassport: (id: string) => apiFetch<PassportVerifyResponse>(`/api/passport/${enc(id)}/verify`),

    // ---- shop console ----
    shopLogin: (body: ShopLoginRequest) => apiFetch<ShopSessionResponse>('/api/shop/session', { body }),
    shopSession: () => apiFetch<ShopSessionResponse>('/api/shop/session'),
    shopLogout: () => apiFetch<OkResponse>('/api/shop/session', { method: 'DELETE' }),
    shopJobs: (status?: readonly JobStatus[]) => apiFetch<ShopJobListResponse>(`/api/shop/jobs${statusQuery(status)}`),
    shopJob: (jobId: string) => apiFetch<ShopJobDetail>(`/api/shop/jobs/${enc(jobId)}`),
    acceptJob: (jobId: string) => apiFetch<ShopJobDetail>(`/api/shop/jobs/${enc(jobId)}/accept`, { method: 'POST' }),
    declineJob: (jobId: string, body: DeclineJobRequest) => apiFetch<ShopJobDetail>(`/api/shop/jobs/${enc(jobId)}/decline`, { body }),
    recordMilestone: (jobId: string, body: MilestoneRequest) => apiFetch<MilestoneView>(`/api/shop/jobs/${enc(jobId)}/milestones`, { body }),
    qaUpload: (jobId: string, body: QaUploadRequest) => apiFetch<QaUploadResponse>(`/api/shop/jobs/${enc(jobId)}/uploads`, { body }),
    submitInspection: (jobId: string, body: InspectionSubmitRequest) =>
        apiFetch<InspectionResultView>(`/api/shop/jobs/${enc(jobId)}/inspection`, { body }),
    createShipment: (jobId: string, body: CreateShipmentRequest) => apiFetch<ShipmentView>(`/api/shop/jobs/${enc(jobId)}/shipment`, { body }),

    // ---- ops (admin token kept in sessionStorage by the /admin page) ----
    adminOrders: (token: string, status?: readonly OrderStatus[]) =>
        apiFetch<AdminOrderListResponse>(`/api/admin/orders${statusQuery(status)}`, { headers: { authorization: `Bearer ${token}` } }),
    adminOrder: (token: string, orderId: string) =>
        apiFetch<AdminOrderDetail>(`/api/admin/orders/${enc(orderId)}`, { headers: { authorization: `Bearer ${token}` } }),
    adminDispatch: (token: string, orderId: string) =>
        apiFetch<AdminDispatchResponse>(`/api/admin/orders/${enc(orderId)}/dispatch`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }),
    adminMarkDelivered: (token: string, shipmentId: string, body: MarkDeliveredRequest = {}) =>
        apiFetch<ShipmentView>(`/api/admin/shipments/${enc(shipmentId)}/delivered`, { body, headers: { authorization: `Bearer ${token}` } }),
    /** Marks the order's latest shipment delivered (POST /api/admin/orders/:orderId/delivered, shop agent route). */
    adminMarkOrderDelivered: (token: string, orderId: string, body: MarkDeliveredRequest = {}) =>
        apiFetch<ShipmentView>(`/api/admin/orders/${enc(orderId)}/delivered`, { body, headers: { authorization: `Bearer ${token}` } }),
    adminExpireOffers: (token: string) =>
        apiFetch<{ expired: number }>('/api/admin/offers/expire', { method: 'POST', headers: { authorization: `Bearer ${token}` } }),
};
