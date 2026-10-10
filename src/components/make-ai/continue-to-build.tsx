'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';

type MakeAiBuildResponse = { buildId: string; displayId: string; created: boolean };

/**
 * "Continue to Build" (workflow 01): POST /api/make-ai/builds { intentId } turns the Make AI
 * plan into a persistent Build (idempotent per plan), then opens its workspace.
 */
export function ContinueToBuild({ intentId, className }: { intentId: string; className?: string }) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onClick() {
        setPending(true);
        setError(null);
        try {
            const res = await apiFetch<MakeAiBuildResponse>('/api/make-ai/builds', { body: { intentId } });
            router.push(`/build/${encodeURIComponent(res.buildId)}/workspace`);
        } catch (err) {
            setError(errorMessage(err));
            setPending(false);
        }
    }

    return (
        <div className={className}>
            <Button onClick={onClick} loading={pending} data-testid="continue-to-build">
                {pending ? 'Creating your build…' : 'Continue to Build'}
                {!pending && <ArrowRight className="h-4 w-4" aria-hidden />}
            </Button>
            {error && (
                <p role="alert" className="mt-2 text-xs font-medium text-ember">
                    {error}
                </p>
            )}
        </div>
    );
}
