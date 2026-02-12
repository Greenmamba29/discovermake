"use client";

import { useMemo } from "react";
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    Node,
    Edge,
    MarkerType,
    Position
} from "reactflow";
import "reactflow/dist/style.css";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Zap, Database, Mail, MessageSquare, FileText, CheckCircle2 } from "lucide-react";

// Custom Node Types could be defined here for richer UI
// For now, we use standard nodes with custom styling via classes

const iconMap: Record<string, any> = {
    trigger: Zap,
    process: FileText,
    database: Database,
    action: Mail,
    slack: MessageSquare
};

export const BlueprintVisualizer = ({
    nodes: initialNodes,
    edges: initialEdges,
    className
}: {
    nodes?: Node[];
    edges?: Edge[];
    className?: string;
}) => {
    // Mock Data if none provided
    const defaultNodes: Node[] = [
        {
            id: '1',
            type: 'input',
            data: { label: 'New Lead via Webhook' },
            position: { x: 50, y: 50 },
            style: { background: '#1e1e2d', color: '#fff', border: '1px solid #7c3aed', borderRadius: '12px', width: 180 }
        },
        {
            id: '2',
            data: { label: 'Enrich Data (Clearbit)' },
            position: { x: 50, y: 150 },
            style: { background: '#1e1e2d', color: '#fff', border: '1px solid #333', borderRadius: '12px', width: 180 }
        },
        {
            id: '3',
            data: { label: 'Filter Qualified?' },
            position: { x: 50, y: 250 },
            style: { background: '#1e1e2d', color: '#fff', border: '1px solid #333', borderRadius: '12px', width: 180 }
        },
        {
            id: '4',
            data: { label: 'Add to CRM (HubSpot)' },
            position: { x: -50, y: 350 },
            style: { background: '#1e1e2d', color: '#fff', border: '1px solid #10b981', borderRadius: '12px', width: 180 }
        },
        {
            id: '5',
            data: { label: 'Notify Sales (Slack)' },
            position: { x: 150, y: 350 },
            style: { background: '#1e1e2d', color: '#fff', border: '1px solid #06b6d4', borderRadius: '12px', width: 180 }
        },
    ];

    const defaultEdges: Edge[] = [
        { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#555' } },
        { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: '#555' } },
        { id: 'e3-4', source: '3', target: '4', label: 'Yes', animated: true, style: { stroke: '#10b981' } },
        { id: 'e3-5', source: '3', target: '5', label: 'Yes', animated: true, style: { stroke: '#10b981' } },
    ];

    const nodes = initialNodes || defaultNodes;
    const edges = initialEdges || defaultEdges;

    return (
        <div className={cn("w-full h-[500px] rounded-xl overflow-hidden border border-white/10 bg-black/40 backdrop-blur-md relative group", className)}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                attributionPosition="bottom-right"
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#333" gap={16} size={1} className="opacity-20" />
                <Controls className="bg-white/10 border-white/10 fill-white text-white" />
            </ReactFlow>

            {/* Overlay Badge */}
            <div className="absolute top-4 left-4 z-10 px-3 py-1 rounded-full bg-primary/20 border border-primary/50 text-xs font-medium text-primary-foreground flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Live Blueprint Preview
            </div>

            <div className="absolute bottom-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <span className="text-xs text-neutral-500">Pan & Zoom to explore</span>
            </div>
        </div>
    );
};
