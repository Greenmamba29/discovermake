'use client';

/**
 * "Build Graph" panel for the buyer order tracker. Reads the same polled OrderView
 * as the tracker (shared react-query cache, no extra request), maps it with the pure
 * `buildGraphFromOrder`, and lazy-loads the xyflow canvas only when the panel is open.
 * Collapsed by default below the `sm` breakpoint.
 */
import dynamic from 'next/dynamic';
import { useId, useMemo, useState } from 'react';
import { ChevronDown, Network } from 'lucide-react';
import type { OrderView } from '@/contracts';
import { useOrder } from '@/components/orders/use-order';
import { buildGraphFromOrder } from '@/lib/build-graph';
import { cn } from '@/lib/utils';
import { useMediaQuery } from './use-media-query';

const GraphView = dynamic(() => import('./GraphView'), {
    ssr: false,
    loading: () => <div className="skeleton h-[320px] w-full rounded-xl sm:h-[380px]" role="status" aria-label="Loading the Build Graph" />,
});

export function BuildGraphSection({ order }: { order: OrderView }) {
    const graph = useMemo(() => buildGraphFromOrder(order), [order]);
    const isDesktop = useMediaQuery('(min-width: 640px)', false);
    const [toggled, setToggled] = useState<boolean | null>(null);
    const open = toggled ?? isDesktop;
    const bodyId = useId();
    const done = graph.nodes.filter((n) => n.state === 'done').length;

    return (
        <section aria-labelledby="build-graph-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="build-graph-panel">
            <h2 id="build-graph-heading" className="font-display text-lg font-bold">
                <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => setToggled(!open)}
                >
                    <span className="inline-flex items-center gap-2">
                        <Network className="h-5 w-5 text-signal" aria-hidden />
                        Build Graph
                    </span>
                    <span className="inline-flex items-center gap-2 font-mono text-[11px] font-normal text-fg-subtle">
                        {done}/{graph.nodes.length} done
                        <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
                    </span>
                </button>
            </h2>
            <div id={bodyId} hidden={!open}>
                <p className="mt-1 text-sm text-fg-muted">How your part is made: material, process, shop, inspection and delivery, from the live order record.</p>
                {open && <GraphView graph={graph} className="mt-4" />}
            </div>
        </section>
    );
}

/** Order-page placement: renders nothing until the tracker's order has loaded. */
export function BuildGraphPanel({ orderId, token }: { orderId: string; token: string | null }) {
    const { data: order } = useOrder(orderId, token);
    if (!token || !order) return null;
    return (
        <div className="mx-auto -mt-10 w-full max-w-6xl px-4 pb-16 sm:px-6">
            <BuildGraphSection order={order} />
        </div>
    );
}
