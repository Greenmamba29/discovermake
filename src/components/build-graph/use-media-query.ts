'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Hydration-safe media query: the server snapshot is `serverValue`, the client
 * reads `matchMedia` and re-renders on change.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            if (typeof window === 'undefined' || !window.matchMedia) return () => {};
            const mql = window.matchMedia(query);
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        },
        [query],
    );
    return useSyncExternalStore(
        subscribe,
        () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : serverValue),
        () => serverValue,
    );
}

export function usePrefersReducedMotion(): boolean {
    return useMediaQuery('(prefers-reduced-motion: reduce)', true);
}
