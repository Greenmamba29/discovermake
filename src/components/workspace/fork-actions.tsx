'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, GitFork } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { workspaceApi } from './workspace-api';

/**
 * Remix (fork with a DERIVED_FROM edge) and Make This (clone). Both copy the latest
 * APPROVED version, so they stay disabled until a version is approved.
 */
export function ForkActions({ buildId, approvedVersion }: { buildId: string; approvedVersion: number | null }) {
    const router = useRouter();
    const [pending, setPending] = useState<'remix' | 'clone' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const disabled = approvedVersion === null || pending !== null;

    async function fork(kind: 'remix' | 'clone') {
        setPending(kind);
        setError(null);
        try {
            const res = await workspaceApi.fork(buildId, kind);
            router.push(`/build/${encodeURIComponent(res.buildId)}/workspace`);
        } catch (err) {
            setError(errorMessage(err));
            setPending(null);
        }
    }

    return (
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={disabled} loading={pending === 'remix'} onClick={() => fork('remix')} aria-describedby={approvedVersion === null ? 'fork-hint' : undefined}>
                    {pending !== 'remix' && <GitFork className="h-4 w-4" aria-hidden />}
                    Remix
                </Button>
                <Button size="sm" disabled={disabled} loading={pending === 'clone'} onClick={() => fork('clone')} aria-describedby={approvedVersion === null ? 'fork-hint' : undefined}>
                    {pending !== 'clone' && <Copy className="h-4 w-4" aria-hidden />}
                    Make This
                </Button>
            </div>
            {approvedVersion === null ? (
                <p id="fork-hint" className="text-xs text-fg-subtle">
                    Approve a version to remix or make it.
                </p>
            ) : (
                <p className="text-xs text-fg-subtle">Copies approved v{approvedVersion} into a new build.</p>
            )}
            {error && (
                <p role="alert" className="text-xs font-medium text-ember">
                    {error}
                </p>
            )}
        </div>
    );
}
