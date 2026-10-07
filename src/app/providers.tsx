'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiClientError } from '@/lib/api'

export function Providers({ children }: { children: React.ReactNode }) {
    const [client] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 5_000,
                        refetchOnWindowFocus: false,
                        // never retry client errors (bad token, not found); retry transient ones twice
                        retry: (count, err) => !(err instanceof ApiClientError && err.status >= 400 && err.status < 500) && count < 2,
                    },
                },
            }),
    )
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
