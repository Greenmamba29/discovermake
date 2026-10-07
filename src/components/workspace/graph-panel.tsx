'use client';

/**
 * Workspace Graph View (spec §8.4): the persisted Build Graph of the viewed version, drawn
 * with the order page's read-only xyflow canvas via `buildGraphFromView`.
 */
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { Network } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import { buildGraphFromView } from '@/lib/build-graph';
import { PanelCard } from './panels';

const GraphView = dynamic(() => import('@/components/build-graph/GraphView'), {
    ssr: false,
    loading: () => <div className="skeleton h-[420px] w-full rounded-xl" role="status" aria-label="Loading the Build Graph" />,
});

export function GraphPanel({ view }: { view: BuildGraphView }) {
    const graph = useMemo(() => buildGraphFromView(view), [view]);
    return (
        <PanelCard title={`Build Graph · v${view.version.version}`} icon={<Network className="h-5 w-5" />} testId="workspace-graph">
            <p className="mb-3 text-sm text-fg-muted">
                {graph.nodes.length} nodes and {graph.edges.length} links in this version. Dashed cards are Make AI drafts; amber ones need your answer or sourcing.
            </p>
            <GraphView graph={graph} className="h-[420px] sm:h-[520px]" />
        </PanelCard>
    );
}
