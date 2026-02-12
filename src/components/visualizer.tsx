"use client";

import React, { useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    Handle,
    Position,
    Node,
    Edge,
    MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';

const CustomNode = ({ data }: { data: { label: string, app?: string, type?: string } }) => {
    const isTrigger = data.type === 'trigger' || data.label.toLowerCase().includes('trigger');

    return (
        <div className={`px-4 py-3 shadow-2xl rounded-2xl border backdrop-blur-xl min-w-[180px] text-center relative group transition-all duration-500
            ${isTrigger ? 'bg-indigo-600/20 border-indigo-500/50' : 'bg-slate-900/80 border-slate-700'}
        `}>
            <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-blue-500" />
            <div className={`text-[10px] uppercase tracking-[0.2em] mb-1 font-bold
                ${isTrigger ? 'text-indigo-400' : 'text-slate-500'}
            `}>
                {isTrigger ? 'Trigger' : 'Module'}
            </div>
            <div className="font-bold text-sm text-white tracking-tight">{data.label}</div>
            {data.app && <div className="text-[10px] text-slate-400 mt-1">{data.app}</div>}
            <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-blue-500" />

            <div className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none
                ${isTrigger ? 'bg-indigo-500/5' : 'bg-blue-500/5'}
            `} />
        </div>
    );
};

const nodeTypes = {
    custom: CustomNode,
};

interface VisualizerProps {
    data: {
        nodes: Array<{ id: string, label: string, app?: string, type?: string }>;
        edges: Array<{ from: string, to: string }>;
    };
}

export function BlueprintVisualizer({ data }: VisualizerProps) {
    const { nodes, edges } = useMemo(() => {
        const flowNodes: Node[] = data.nodes.map((node, i) => ({
            id: node.id,
            type: 'custom',
            data: { label: node.label, app: node.app, type: node.type },
            position: { x: i * 250, y: 100 }, // Simple horizontal layout
        }));

        const flowEdges: Edge[] = data.edges.map((edge, i) => ({
            id: `e${i}`,
            source: edge.from,
            target: edge.to,
            animated: true,
            style: { stroke: '#6366f1', strokeWidth: 3 },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: '#6366f1',
            },
        }));

        return { nodes: flowNodes, edges: flowEdges };
    }, [data]);

    return (
        <div className="w-full h-[500px] bg-slate-950 rounded-3xl border border-slate-800/10 shadow-2xl relative group/visualizer overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                zoomOnScroll={false}
                zoomOnPinch={false}
                panOnDrag={true}
            >
                <Background color="#1e293b" gap={20} size={1} />
                <Controls className="!bg-slate-900 !border-slate-800 !fill-white" />
            </ReactFlow>
        </div>
    );
}
