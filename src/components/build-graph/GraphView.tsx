'use client';

/**
 * Read-only Build Graph canvas (spec §8.4 Graph View), ported from the pre-pivot
 * reactflow visualizer (00b8e00:src/components/visualizer.tsx) onto @xyflow/react v12.
 *
 * Load this with next/dynamic({ ssr: false }); it pulls in the xyflow runtime + CSS.
 * Nodes are keyboard focusable (Tab), nothing is draggable, connectable or selectable,
 * and a visually hidden list repeats every node for screen readers.
 */
import { memo, useMemo, type CSSProperties } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StatusPill } from '@/components/ui/status-pill';
import { EDGE_PHRASE, GRAPH_LAYOUT, describeNode, layoutBuildGraph, type BuildGraph, type BuildGraphEdgeState, type BuildGraphNode, type BuildGraphNodeState } from '@/lib/build-graph';
import { UNIVERSAL_PILL } from '@/lib/status';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from './use-media-query';

type GraphNodeData = { node: BuildGraphNode };
type GraphFlowNode = Node<GraphNodeData, 'buildGraph'>;

/** Design tokens (tailwind.config.ts) for SVG strokes, which cannot take Tailwind classes. */
const SIGNAL = '#5fe08a';
const SIGNAL_DIM = '#2f6e45';
const PENDING = '#4b5150';

const CARD_STATE: Record<BuildGraphNodeState, string> = {
    done: 'border-signal/40 bg-graphite-850',
    active: 'border-signal bg-graphite-850 shadow-[0_0_0_4px_rgba(95,224,138,0.12)]',
    pending: 'border-dashed border-graphite-500 bg-graphite-900',
    failed: 'border-ember/60 bg-graphite-850',
    cancelled: 'border-graphite-600 bg-graphite-900 opacity-70',
};

const EDGE_STYLE: Record<BuildGraphEdgeState, CSSProperties> = {
    done: { stroke: SIGNAL_DIM, strokeWidth: 2 },
    active: { stroke: SIGNAL, strokeWidth: 2 },
    pending: { stroke: PENDING, strokeWidth: 1.5, strokeDasharray: '5 5' },
};

const BuildGraphNodeCard = memo(function BuildGraphNodeCard({ data }: NodeProps<GraphFlowNode>) {
    const n = data.node;
    return (
        <div
            className={cn(
                'flex flex-col justify-between rounded-2xl border px-3.5 py-3 text-left text-fg',
                CARD_STATE[n.state],
                // Focus ring for keyboard users (xyflow puts focus on the wrapper div).
                '[.react-flow__node:focus-visible_&]:outline [.react-flow__node:focus-visible_&]:outline-2 [.react-flow__node:focus-visible_&]:outline-offset-2 [.react-flow__node:focus-visible_&]:outline-signal',
            )}
            style={{ width: GRAPH_LAYOUT.nodeWidth, height: GRAPH_LAYOUT.nodeHeight }}
            data-testid={`build-graph-node-${n.id}`}
            data-state={n.state}
        >
            <Handle type="target" position={Position.Left} isConnectable={false} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-graphite-500" />
            <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{n.typeLabel}</p>
                <p className="mt-0.5 truncate font-display text-sm font-semibold leading-tight" title={n.label}>
                    {n.label}
                </p>
                {n.value && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted" title={n.value}>
                        {n.value}
                    </p>
                )}
            </div>
            <StatusPill status={n.status} className="self-start px-2 py-0.5 text-[10px]" />
            <Handle type="source" position={Position.Right} isConnectable={false} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-graphite-500" />
        </div>
    );
});

const nodeTypes = { buildGraph: BuildGraphNodeCard };

/** Visually hidden, ordered text version of the graph (same nodes, same order). */
export function GraphTextList({ graph, id }: { graph: BuildGraph; id?: string }) {
    return (
        <ol className="sr-only" id={id} aria-label="Build Graph, in order">
            {graph.nodes.map((n) => (
                <li key={n.id}>{describeNode(n, graph, UNIVERSAL_PILL[n.status].label)}</li>
            ))}
        </ol>
    );
}

export function GraphView({ graph, className }: { graph: BuildGraph; className?: string }) {
    const reducedMotion = usePrefersReducedMotion();

    const { nodes, edges } = useMemo(() => {
        const positions = layoutBuildGraph(graph);
        const labelById = new Map(graph.nodes.map((n) => [n.id, n.label]));
        const flowNodes: GraphFlowNode[] = graph.nodes.map((n) => ({
            id: n.id,
            type: 'buildGraph',
            position: positions.get(n.id) ?? { x: 0, y: 0 },
            data: { node: n },
            width: GRAPH_LAYOUT.nodeWidth,
            height: GRAPH_LAYOUT.nodeHeight,
            ariaLabel: describeNode(n, graph, UNIVERSAL_PILL[n.status].label),
            draggable: false,
            selectable: false,
            connectable: false,
            deletable: false,
        }));
        // Label only the first edge into each node group so fan-in/fan-out edges stay readable.
        const labelled = new Set<string>();
        const flowEdges: Edge[] = graph.edges.map((e) => {
            const target = graph.nodes.find((n) => n.id === e.target);
            const groupKey = `${e.type}:${target?.column ?? e.target}`;
            const showLabel = !labelled.has(groupKey);
            labelled.add(groupKey);
            const stroke = EDGE_STYLE[e.state].stroke as string;
            return {
                id: e.id,
                source: e.source,
                target: e.target,
                type: 'smoothstep',
                animated: e.state === 'active' && !reducedMotion,
                style: EDGE_STYLE[e.state],
                markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
                label: showLabel ? e.type : undefined,
                labelStyle: { fill: '#8b928e', fontFamily: 'var(--font-jetbrains), ui-monospace, monospace', fontSize: 9, letterSpacing: '0.08em' },
                labelBgStyle: { fill: '#111413' },
                labelBgPadding: [4, 2] as [number, number],
                labelBgBorderRadius: 4,
                ariaLabel: `${labelById.get(e.source) ?? e.source} ${EDGE_PHRASE[e.type]} ${labelById.get(e.target) ?? e.target}`,
                focusable: false,
                selectable: false,
                deletable: false,
            };
        });
        return { nodes: flowNodes, edges: flowEdges };
    }, [graph, reducedMotion]);

    return (
        <div className={cn('relative h-[320px] w-full overflow-hidden rounded-xl bg-graphite-950 ring-1 ring-graphite-700 sm:h-[380px]', className)} data-testid="build-graph-canvas">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                colorMode="dark"
                fitView
                fitViewOptions={{ padding: 0.12, duration: 0 }}
                minZoom={0.3}
                maxZoom={1.5}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable
                edgesFocusable={false}
                edgesReconnectable={false}
                elementsSelectable={false}
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                zoomOnScroll={false}
                zoomOnDoubleClick={false}
                preventScrolling={false}
                panOnDrag
                aria-label="Build Graph diagram. Use Tab to move between steps."
                style={
                    {
                        '--xy-background-color': '#0c0e0d',
                        '--xy-edge-label-background-color': '#111413',
                        '--xy-controls-button-background-color': '#1a1d1c',
                        '--xy-controls-button-background-color-hover': '#272b2a',
                        '--xy-controls-button-color': '#eceeeb',
                        '--xy-controls-button-color-hover': '#eceeeb',
                        '--xy-controls-button-border-color': '#272b2a',
                        '--xy-attribution-background-color': 'transparent',
                    } as CSSProperties
                }
            >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#272b2a" />
                <Controls showInteractive={false} position="bottom-left" fitViewOptions={{ padding: 0.12, duration: reducedMotion ? 0 : 200 }} />
            </ReactFlow>
            <GraphTextList graph={graph} />
        </div>
    );
}

export default GraphView;
