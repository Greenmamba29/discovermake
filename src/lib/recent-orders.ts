/**
 * "Track order" convenience: the signed order links this browser has created,
 * kept in localStorage only (never sent anywhere). Every access is wrapped in
 * try/catch: storage can be blocked or empty and the UI must still work.
 */
export type RecentOrder = { orderId: string; orderNumber: string; url: string; createdAt: string };

const KEY = 'dm.recentOrders.v1';

export function readRecentOrders(): RecentOrder[] {
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed.filter((o) => o && typeof o.url === 'string') as RecentOrder[]) : [];
    } catch {
        return [];
    }
}

export function rememberOrder(order: RecentOrder): void {
    try {
        const next = [order, ...readRecentOrders().filter((o) => o.orderId !== order.orderId)].slice(0, 10);
        window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        // storage unavailable: tracking still works from the emailed link
    }
}

/** Accepts a full order URL (`/orders/:id?t=...`) and returns the in-app path, or null. */
export function parseOrderLink(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        const u = new URL(trimmed, 'https://placeholder.local');
        const m = u.pathname.match(/^\/orders\/(ord_[A-Za-z0-9_-]+)\/?$/);
        const t = u.searchParams.get('t') ?? u.searchParams.get('token');
        if (!m || !t) return null;
        return `/orders/${m[1]}?t=${encodeURIComponent(t)}`;
    } catch {
        return null;
    }
}
