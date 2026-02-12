"use client";

import React, { useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    Handle,
    Position,
    Node,
    Edge
} from 'reactflow';
import 'reactflow/dist/style.css';
import { motion } from 'framer-motion';

// Custom Node Component for a Premium Look
const CustomNode = ({ data }: { data: { label: string, icon?: string } }) => {
    return (
        <div className="px-4 py-3 shadow-lg rounded-xl bg-slate-900/90 border border-slate-700 backdrop-blur-md text-white min-w-[150px] text-center relative group">
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-blue-500" />
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Module</div>
            <div className="font-bold text-sm tracking-tight">{data.label}</div>
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-blue-500" />

            {/* Glow effect on hover */}
            <div className="absolute inset-0 rounded-xl bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>
    );
};

const nodeTypes = {
    custom: CustomNode,
};

interface BlueprintProps {
    usedApps: string[];
}

export default function BlueprintVisualization({ usedApps }: BlueprintProps) {
    // Transform usedApps list into nodes and edges
    const { nodes, edges } = useMemo(() => {
        const generatedNodes: Node[] = [];
        const generatedEdges: Edge[] = [];

        // Add a "Trigger" start node
        generatedNodes.push({
            id: 'start',
            type: 'custom',
            data: { label: 'Trigger / Start', icon: 'zap' },
            position: { x: 50, y: 150 },
        });

        // Map apps to nodes (Horizontal Layout)
        let lastX = 50;
        const spacing = 250;

        const appsToRender = usedApps.length > 0 ? usedApps : ['Process Data', 'Update Record']; // Fallbacks

        appsToRender.forEach((app, index) => {
            const nodeId = `node-${index}`;
            const x = 50 + ((index + 1) * spacing);
            lastX = x;

            generatedNodes.push({
                id: nodeId,
                type: 'custom',
                data: { label: app.charAt(0).toUpperCase() + app.slice(1) },
                position: { x: x, y: 150 + (index % 2 === 0 ? 0 : 50) }, // Slight wave effect
            });

            // Connect
            const sourceId = index === 0 ? 'start' : `node-${index - 1}`;
            generatedEdges.push({
                id: `edge-${index}`,
                source: sourceId,
                target: nodeId,
                animated: true,
                style: { stroke: '#3b82f6', strokeWidth: 3 },
            });
        });

        // Add "Success" end node for closure
        generatedNodes.push({
            id: 'end',
            type: 'custom',
            data: { label: 'Success' },
            position: { x: lastX + spacing, y: 150 },
        });
        generatedEdges.push({
            id: 'edge-end',
            source: appsToRender.length > 0 ? `node-${appsToRender.length - 1}` : 'start',
            target: 'end',
            animated: true,
            style: { stroke: '#10b981', strokeWidth: 3 },
        });

        return { nodes: generatedNodes, edges: generatedEdges };
    }, [usedApps]);

    return (
        <div className="w-full h-[400px] bg-slate-950 rounded-xl border border-slate-800 overflow-hidden relative">
            <div className="absolute top-4 left-4 z-10">
                <div className="bg-slate-900/80 backdrop-blur text-white px-3 py-1 rounded-full text-xs font-bold border border-slate-700 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    Live Blueprint Preview
                </div>
            </div>

            <ReactFlow
                defaultNodes={nodes}
                defaultEdges={edges}
                nodeTypes={nodeTypes}
                fitView
                zoomOnScroll={false}
                zoomOnPinch={false}
                panOnDrag={true} // Allow panning
                attributionPosition="bottom-right"
            >
                <Background color="#1e293b" gap={16} />
                <Controls className="bg-slate-800 border-slate-700 fill-white" />
            </ReactFlow>
        </div>
    );
}
