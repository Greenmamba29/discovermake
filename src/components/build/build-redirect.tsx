'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';

/**
 * Spec routes (/build/:buildId/configure|quote) resolve to the part configurator,
 * which holds configure + instant quote on one screen.
 */
export function BuildRedirect({ buildId, quoteId }: { buildId: string; quoteId: string | null }) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (quoteId) {
                    const q = await api.getQuote(quoteId);
                    if (!cancelled) router.replace(`/parts/${q.partId}?from=${encodeURIComponent(q.id)}`);
                    return;
                }
                const b = await api.getBuild(buildId);
                if (!b.part) throw new Error('This build has no part yet.');
                if (!cancelled) router.replace(`/parts/${b.part.id}${b.latestQuoteId ? `?from=${encodeURIComponent(b.latestQuoteId)}` : ''}`);
            } catch (err) {
                if (!cancelled) setError(errorMessage(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [buildId, quoteId, router]);

    if (error) return <ErrorState title="Could not open this build" message={error} action={<ButtonLink href="/make">Upload a part</ButtonLink>} />;
    return <PageSkeleton label="Opening your build" />;
}
