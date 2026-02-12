"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Users,
    Plus,
    X,
    Code2,
    Palette,
    Server,
    Briefcase,
    CheckCircle2,
    Clock,
    ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * US-006: Multi-Maker Team Assembly
 * 
 * For large projects (>$5k), Seekers can build a "Dream Team"
 * by selecting multiple Makers for different roles.
 */

interface TeamRole {
    id: string;
    title: string;
    icon: React.ElementType;
    description: string;
    required: boolean;
    assignedMaker?: {
        id: string;
        initials: string;
        matchScore: number;
        rating: number;
    };
}

const DEFAULT_ROLES: TeamRole[] = [
    {
        id: "frontend",
        title: "Frontend",
        icon: Code2,
        description: "React, UI/UX implementation",
        required: true,
    },
    {
        id: "backend",
        title: "Backend",
        icon: Server,
        description: "API, database, infrastructure",
        required: true,
    },
    {
        id: "design",
        title: "Design",
        icon: Palette,
        description: "UI/UX design, prototyping",
        required: false,
    },
    {
        id: "pm",
        title: "Project Manager",
        icon: Briefcase,
        description: "Coordination, delivery",
        required: false,
    },
];

// Mock available makers per role
const MOCK_MAKERS_BY_ROLE: Record<string, Array<{ id: string; initials: string; matchScore: number; rating: number }>> = {
    frontend: [
        { id: "fe-1", initials: "AR", matchScore: 96, rating: 4.9 },
        { id: "fe-2", initials: "KN", matchScore: 88, rating: 4.9 },
    ],
    backend: [
        { id: "be-1", initials: "PS", matchScore: 92, rating: 4.8 },
        { id: "be-2", initials: "MJ", matchScore: 81, rating: 4.8 },
    ],
    design: [
        { id: "ds-1", initials: "EV", matchScore: 85, rating: 4.6 },
    ],
    pm: [
        { id: "pm-1", initials: "JT", matchScore: 90, rating: 4.7 },
    ],
};

export function TeamAssembly({
    onComplete,
    projectBudget = 8000,
}: {
    onComplete?: (team: TeamRole[]) => void;
    projectBudget?: number;
}) {
    const [roles, setRoles] = useState<TeamRole[]>(DEFAULT_ROLES);
    const [expandedRole, setExpandedRole] = useState<string | null>(null);

    const assignedCount = roles.filter((r) => r.assignedMaker).length;
    const requiredFilled = roles.filter((r) => r.required && r.assignedMaker).length;
    const requiredTotal = roles.filter((r) => r.required).length;
    const isComplete = requiredFilled === requiredTotal;

    const assignMaker = (roleId: string, maker: { id: string; initials: string; matchScore: number; rating: number }) => {
        setRoles((prev) =>
            prev.map((r) =>
                r.id === roleId ? { ...r, assignedMaker: maker } : r
            )
        );
        setExpandedRole(null);
    };

    const removeMaker = (roleId: string) => {
        setRoles((prev) =>
            prev.map((r) =>
                r.id === roleId ? { ...r, assignedMaker: undefined } : r
            )
        );
    };

    return (
        <div className="max-w-xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-full mb-4">
                    <Users className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-black uppercase tracking-widest italic text-blue-400">
                        Dream Team Assembly
                    </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-1">Build Your Team</h2>
                <p className="text-sm text-white/40">
                    Budget: ${projectBudget.toLocaleString()} • Select makers for each role
                </p>
            </div>

            {/* Progress */}
            <div className="flex items-center justify-between mb-6 px-2">
                <span className="text-xs font-bold text-white/40">
                    {assignedCount}/{roles.length} roles filled
                </span>
                <span className={cn(
                    "text-xs font-bold italic",
                    isComplete ? "text-emerald-400" : "text-white/30"
                )}>
                    {isComplete ? "✓ Ready to launch" : `${requiredFilled}/${requiredTotal} required filled`}
                </span>
            </div>

            {/* Role Slots */}
            <div className="space-y-3">
                {roles.map((role) => {
                    const isExpanded = expandedRole === role.id;
                    const availableMakers = MOCK_MAKERS_BY_ROLE[role.id] || [];

                    return (
                        <motion.div
                            key={role.id}
                            layout
                            className={cn(
                                "glass-card rounded-2xl overflow-hidden transition-all",
                                role.assignedMaker && "border-emerald-500/20",
                                isExpanded && "border-purple-500/20"
                            )}
                        >
                            <div
                                className="p-4 flex items-center gap-4 cursor-pointer"
                                onClick={() => !role.assignedMaker && setExpandedRole(isExpanded ? null : role.id)}
                            >
                                <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                                    role.assignedMaker
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : "bg-white/5 text-white/30"
                                )}>
                                    <role.icon className="w-5 h-5" />
                                </div>

                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-black tracking-tight">{role.title}</h4>
                                        {role.required && (
                                            <span className="text-[8px] font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded italic">
                                                Required
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-white/30 font-medium">{role.description}</p>
                                </div>

                                {role.assignedMaker ? (
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-xs font-black text-emerald-400">
                                            {role.assignedMaker.initials}
                                        </div>
                                        <span className="text-xs font-bold text-emerald-400">
                                            {role.assignedMaker.matchScore}%
                                        </span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeMaker(role.id); }}
                                            className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                                        >
                                            <X className="w-3 h-3 text-white/40" />
                                        </button>
                                    </div>
                                ) : (
                                    <ChevronRight className={cn(
                                        "w-4 h-4 text-white/20 transition-transform",
                                        isExpanded && "rotate-90"
                                    )} />
                                )}
                            </div>

                            {/* Expanded: Available makers */}
                            <AnimatePresence>
                                {isExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
                                            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest italic mb-2">
                                                Available Makers
                                            </p>
                                            {availableMakers.map((maker) => (
                                                <button
                                                    key={maker.id}
                                                    onClick={() => assignMaker(role.id, maker)}
                                                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-purple-500/10 border border-white/5 hover:border-purple-500/20 transition-all"
                                                >
                                                    <div className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center text-xs font-black text-purple-400">
                                                        {maker.initials}
                                                    </div>
                                                    <div className="flex-1 text-left">
                                                        <span className={cn(
                                                            "text-xs font-black px-2 py-0.5 rounded-full",
                                                            maker.matchScore >= 90
                                                                ? "bg-emerald-500/20 text-emerald-400"
                                                                : "bg-white/10 text-white/50"
                                                        )}>
                                                            {maker.matchScore}% match
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] text-white/30 flex items-center gap-1">
                                                        ★ {maker.rating}
                                                    </span>
                                                    <Plus className="w-4 h-4 text-white/20" />
                                                </button>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
            </div>

            {/* Launch Button */}
            <motion.div
                className="mt-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: isComplete ? 1 : 0.3 }}
            >
                <Button
                    disabled={!isComplete}
                    onClick={() => onComplete?.(roles)}
                    className="w-full h-14 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-black text-lg shadow-lg shadow-purple-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    {isComplete ? "Launch Project" : "Fill required roles to continue"}
                </Button>
            </motion.div>
        </div>
    );
}
