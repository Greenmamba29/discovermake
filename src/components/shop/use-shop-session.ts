'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useShopSession() {
    return useQuery({ queryKey: ['shop-session'], queryFn: api.shopSession, retry: false, staleTime: 60_000 });
}
