'use client';

import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@/contracts';
import { api } from '@/lib/api';

const TERMINAL: ReadonlySet<OrderStatus> = new Set(['COMPLETE', 'CANCELLED', 'REFUNDED']);

/** Poll interval while an order is moving. Acceptance: milestones visible to the buyer within 5 s. */
export const ORDER_POLL_MS = 3_000;

export function isTerminalOrder(status: OrderStatus): boolean {
    return TERMINAL.has(status);
}

/** GET /api/orders/:id with the signed order token; polls while active, pauses in background tabs. */
export function useOrder(orderId: string, token: string | null) {
    return useQuery({
        queryKey: ['order', orderId, token],
        queryFn: () => api.getOrder(orderId, token!),
        enabled: Boolean(token),
        refetchInterval: (q) => {
            const status = q.state.data?.status;
            if (!status) return q.state.error ? false : ORDER_POLL_MS;
            if (isTerminalOrder(status)) return false;
            if (status === 'PAYMENT_FAILED') return 15_000;
            return ORDER_POLL_MS;
        },
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        staleTime: 0,
    });
}
