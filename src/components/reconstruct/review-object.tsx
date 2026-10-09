'use client';

/** The generated GLB in the workspace Object View (reused as is), scoped to this build. */
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { ObjectView } from '@/components/workspace/object-view/object-view';
import { graphQueryKey, workspaceApi } from '@/components/workspace/workspace-api';
import { errorMessage } from '@/lib/api';

export function ReviewObject({ buildId }: { buildId: string }) {
    const router = useRouter();
    const graph = useQuery({ queryKey: graphQueryKey(buildId, null), queryFn: ({ signal }) => workspaceApi.graph(buildId, null, signal) });
    if (graph.isPending) return <Skeleton className="h-[340px] w-full rounded-2xl" />;
    if (graph.isError) return <Notice tone="error">{errorMessage(graph.error)}</Notice>;
    return <ObjectView view={graph.data} onGo={(section) => router.push(`/build/${encodeURIComponent(buildId)}/workspace?section=${section}`)} />;
}
