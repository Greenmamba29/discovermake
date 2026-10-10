'use client';

/**
 * /make/ai entry to "Make it in 3D": describe an object, Make AI writes the 3D model and the CAD
 * worker builds it; on success the buyer lands in the new build's Object View to check it,
 * approve it and get a binding print quote. Without a model key or CAD worker it shows the
 * honest unavailable state and creates nothing. Adult buyers only (Kids mode uses templates).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Box } from 'lucide-react';
import { CreateMakeIt3dBuildResponse, MakeIt3dAvailability, MakeIt3dResponse } from '@/contracts/make-it-3d';
import { ButtonLink } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { apiFetch, errorMessage } from '@/lib/api';
import { MakeIt3dFailureNotice, MakeIt3dForm, MakeIt3dProgress, type MakeIt3dFailure } from './make-it-3d-form';

const enc = encodeURIComponent;

export const makeIt3dEntryApi = {
    availability: async (signal?: AbortSignal) => MakeIt3dAvailability.parse(await apiFetch<unknown>('/api/text-to-cad', { signal })),
    createBuild: async (prompt: string) => CreateMakeIt3dBuildResponse.parse(await apiFetch<unknown>('/api/text-to-cad', { body: { prompt } })),
    make: async (buildId: string, prompt: string) => MakeIt3dResponse.parse(await apiFetch<unknown>(`/api/builds/${enc(buildId)}/text-to-cad`, { body: { prompt } })),
};

export function MakeIt3dEntry() {
    const router = useRouter();
    const availability = useQuery({ queryKey: ['make-it-3d-availability'], queryFn: ({ signal }) => makeIt3dEntryApi.availability(signal), retry: false });
    const [failure, setFailure] = useState<{ outcome: MakeIt3dFailure; url: string } | null>(null);
    const make = useMutation({
        mutationFn: async (prompt: string) => {
            const build = await makeIt3dEntryApi.createBuild(prompt);
            return { build, res: await makeIt3dEntryApi.make(build.buildId, prompt) };
        },
        onMutate: () => setFailure(null),
        onSuccess: ({ build, res }) => {
            if (res.status === 'generated') router.push(build.url);
            else setFailure({ outcome: res, url: build.url });
        },
    });

    return (
        <section aria-labelledby="make3d-entry-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-6" data-testid="make3d-entry">
            <h2 id="make3d-entry-heading" className="flex items-center gap-2 font-display text-xl font-bold">
                <Box className="h-5 w-5 text-signal" aria-hidden /> Make it in 3D
            </h2>
            <p className="mt-2 text-sm text-fg-muted">Already know the shape? Make AI writes a 3D model you can turn around and measure. You approve it before you get a binding 3D-print price.</p>
            <div className="mt-4 space-y-3">
                {availability.isPending ? (
                    <Skeleton className="h-24 w-full" />
                ) : availability.isError ? (
                    <Notice tone="error">{errorMessage(availability.error)}</Notice>
                ) : !availability.data.available ? (
                    <Notice tone="info" title="Make it in 3D is not available" testId="make3d-unavailable">
                        {availability.data.reason}
                    </Notice>
                ) : (
                    <>
                        <MakeIt3dForm busy={make.isPending} onSubmit={(p) => make.mutate(p)} />
                        {make.isPending && <MakeIt3dProgress />}
                        {make.error && <Notice tone="error">{errorMessage(make.error)}</Notice>}
                        {failure && (
                            <>
                                <MakeIt3dFailureNotice outcome={failure.outcome} />
                                <ButtonLink href={failure.url} variant="secondary" size="sm" data-testid="make3d-open-build">
                                    Open the build to try again
                                </ButtonLink>
                            </>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
