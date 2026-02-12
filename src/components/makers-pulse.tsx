"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Zap,
    Star,
    Clock,
    CheckCircle2,
    Shield,
    Loader2,
    MapPin,
    Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * US-005: "Makers in the Area" — Uber-Style On-Demand Matching
 * 
 * H3 hexagonal pulse loading state with animated maker dots
 * converging toward the Seeker position.
 */

interface MatchedMaker {
    id: string;
    initials: string;
    matchScore: number;
    skills: string[];
    rating: number;
    eta: string; // e.g. "Available now", "2 min"
    angle: number; // Position angle on the radar
    distance: number; // 0-1, how far from center
}

const MOCK_MATCHED_MAKERS: MatchedMaker[] = [
    { id: "m1", initials: "AR", matchScore: 96, skills: ["React", "Next.js"], rating: 4.9, eta: "Available now", angle: 30, distance: 0.4 },
    { id: "m2", initials: "PS", matchScore: 92, skills: ["Python", "ML/AI"], rating: 4.8, eta: "Available now", angle: 120, distance: 0.55 },
    { id: "m3", initials: "KN", matchScore: 88, skills: ["UI/UX", "React Native"], rating: 4.9, eta: "2 min", angle: 200, distance: 0.65 },
    { id: "m4", initials: "SK", matchScore: 84, skills: ["Solidity", "Web3"], rating: 4.7, eta: "5 min", angle: 280, distance: 0.75 },
    { id: "m5", initials: "MJ", matchScore: 81, skills: ["iOS", "Swift"], rating: 4.8, eta: "3 min", angle: 350, distance: 0.5 },
];

type MatchingPhase = "scanning" | "found" | "selecting";

export function MakersPulse({
    onSelect,
    projectTitle,
}: {
    onSelect?: (makerId: string) => void;
    projectTitle?: string;
}) {
    const [phase, setPhase] = useState<MatchingPhase>("scanning");
    const [visibleMakers, setVisibleMakers] = useState<MatchedMaker[]>([]);
    const [selectedMaker, setSelectedMaker] = useState<string | null>(null);
    const [scanProgress, setScanProgress] = useState(0);

    // Simulate scanning → found phases
    useEffect(() => {
        const scanInterval = setInterval(() => {
            setScanProgress((prev) => {
                if (prev >= 100) {
                    clearInterval(scanInterval);
                    return 100;
                }
                return prev + 2;
            });
        }, 60);

        // Stagger maker appearances
        MOCK_MATCHED_MAKERS.forEach((maker, i) => {
            setTimeout(() => {
                setVisibleMakers((prev) => [...prev, maker]);
            }, 800 + i * 600);
        });

        // Transition to "found" after all makers loaded
        setTimeout(() => {
            setPhase("found");
        }, 4200);

        return () => clearInterval(scanInterval);
    }, []);

    const handleSelectMaker = (makerId: string) => {
        setSelectedMaker(makerId);
        setPhase("selecting");
        setTimeout(() => onSelect?.(makerId), 1000);
    };

    return (
        <div className="relative w-full max-w-2xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8">
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 mb-3"
                >
                    <div className={cn(
                        "w-2 h-2 rounded-full animate-pulse",
                        phase === "scanning" ? "bg-amber-400" : "bg-emerald-400"
                    )} />
                    <span className="text-xs font-black uppercase tracking-widest italic text-white/50">
                        {phase === "scanning" ? "Scanning Network" :
                            phase === "found" ? `${visibleMakers.length} Makers Found` :
                                "Connecting..."}
                    </span>
                </motion.div>
                <h2 className="text-2xl font-black tracking-tight mb-1">
                    Makers in the Area
                </h2>
                {projectTitle && (
                    <p className="text-sm text-white/40">For: {projectTitle}</p>
                )}
            </div>

            {/* Radar View */}
            <div className="relative aspect-square max-w-[400px] mx-auto mb-8">
                {/* Pulse rings */}
                {[1, 2, 3].map((ring) => (
                    <motion.div
                        key={ring}
                        className="absolute inset-0 rounded-full border border-purple-500/10"
                        style={{
                            width: `${ring * 33}%`,
                            height: `${ring * 33}%`,
                            top: `${(100 - ring * 33) / 2}%`,
                            left: `${(100 - ring * 33) / 2}%`,
                        }}
                        animate={{
                            opacity: [0.1, 0.3, 0.1],
                            scale: [1, 1.02, 1],
                        }}
                        transition={{
                            duration: 2,
                            delay: ring * 0.3,
                            repeat: Infinity,
                        }}
                    />
                ))}

                {/* Scanning sweep */}
                {phase === "scanning" && (
                    <motion.div
                        className="absolute top-1/2 left-1/2 w-1/2 h-[2px] origin-left"
                        style={{
                            background: "linear-gradient(90deg, rgba(168,85,247,0.6), transparent)",
                        }}
                        animate={{ rotate: [0, 360] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    />
                )}

                {/* Center — Seeker position */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <motion.div
                        className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/30"
                        animate={{ boxShadow: ["0 0 20px rgba(168,85,247,0.3)", "0 0 40px rgba(168,85,247,0.5)", "0 0 20px rgba(168,85,247,0.3)"] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    >
                        <span className="text-xs font-black text-white">YOU</span>
                    </motion.div>
                </div>

                {/* Maker dots */}
                <AnimatePresence>
                    {visibleMakers.map((maker) => {
                        const centerX = 50;
                        const centerY = 50;
                        const maxRadius = 42; // percentage from center
                        const rad = (maker.angle * Math.PI) / 180;
                        const targetX = centerX + Math.cos(rad) * maxRadius * maker.distance;
                        const targetY = centerY + Math.sin(rad) * maxRadius * maker.distance;
                        const isSelected = selectedMaker === maker.id;

                        return (
                            <motion.div
                                key={maker.id}
                                className="absolute z-20"
                                initial={{
                                    left: `${centerX + Math.cos(rad) * 48}%`,
                                    top: `${centerY + Math.sin(rad) * 48}%`,
                                    opacity: 0,
                                    scale: 0,
                                }}
                                animate={{
                                    left: `${isSelected ? centerX : targetX}%`,
                                    top: `${isSelected ? centerY : targetY}%`,
                                    opacity: 1,
                                    scale: isSelected ? 1.3 : 1,
                                }}
                                transition={{ type: "spring", damping: 15, stiffness: 100 }}
                                style={{ transform: "translate(-50%, -50%)" }}
                            >
                                <button
                                    onClick={() => phase === "found" && handleSelectMaker(maker.id)}
                                    className={cn(
                                        "relative group cursor-pointer",
                                        phase !== "found" && "pointer-events-none"
                                    )}
                                >
                                    <div className={cn(
                                        "w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-black border-2 transition-all",
                                        isSelected
                                            ? "bg-emerald-500 border-emerald-400 shadow-lg shadow-emerald-500/30"
                                            : maker.matchScore >= 90
                                                ? "bg-purple-600/80 border-purple-400/50 hover:border-purple-400"
                                                : "bg-white/10 border-white/20 hover:border-white/40"
                                    )}>
                                        {maker.initials}
                                    </div>

                                    {/* Match score tooltip */}
                                    <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span className={cn(
                                            "text-[9px] font-black whitespace-nowrap px-2 py-0.5 rounded-full",
                                            maker.matchScore >= 90
                                                ? "bg-emerald-500/20 text-emerald-400"
                                                : "bg-white/10 text-white/50"
                                        )}>
                                            {maker.matchScore}% match
                                        </span>
                                    </div>

                                    {/* Pulse for available */}
                                    {maker.eta === "Available now" && !isSelected && (
                                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full animate-ping opacity-50" />
                                    )}
                                </button>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* Progress bar */}
            {phase === "scanning" && (
                <motion.div className="mb-6">
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-gradient-to-r from-purple-600 to-blue-500 rounded-full"
                            style={{ width: `${scanProgress}%` }}
                        />
                    </div>
                    <p className="text-[10px] font-bold text-white/30 mt-2 text-center italic">
                        Analyzing {scanProgress}% of maker network...
                    </p>
                </motion.div>
            )}

            {/* Maker list */}
            {phase !== "scanning" && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-2"
                >
                    {visibleMakers
                        .sort((a, b) => b.matchScore - a.matchScore)
                        .map((maker) => (
                            <motion.button
                                key={maker.id}
                                onClick={() => phase === "found" && handleSelectMaker(maker.id)}
                                className={cn(
                                    "w-full glass-card rounded-2xl p-4 flex items-center gap-4 transition-all text-left",
                                    selectedMaker === maker.id
                                        ? "border-emerald-500/30 bg-emerald-500/5"
                                        : selectedMaker
                                            ? "opacity-40 pointer-events-none"
                                            : "hover:border-purple-500/20"
                                )}
                                whileHover={!selectedMaker ? { scale: 1.01 } : undefined}
                            >
                                <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black",
                                    selectedMaker === maker.id
                                        ? "bg-emerald-500 text-white"
                                        : "bg-white/10 text-white/60"
                                )}>
                                    {maker.initials}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={cn(
                                            "text-xs font-black px-2 py-0.5 rounded-full",
                                            maker.matchScore >= 90
                                                ? "bg-emerald-500/20 text-emerald-400"
                                                : "bg-white/10 text-white/50"
                                        )}>
                                            {maker.matchScore}%
                                        </span>
                                        <span className="flex items-center gap-1 text-[10px] text-white/30">
                                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                                            {maker.rating}
                                        </span>
                                    </div>
                                    <div className="flex gap-1.5">
                                        {maker.skills.map((s) => (
                                            <span key={s} className="text-[9px] font-bold uppercase tracking-wider text-white/40 bg-white/5 px-2 py-0.5 rounded-lg italic">
                                                {s}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className={cn(
                                        "text-[10px] font-bold italic",
                                        maker.eta === "Available now" ? "text-emerald-400" : "text-white/30"
                                    )}>
                                        {maker.eta}
                                    </span>
                                </div>
                            </motion.button>
                        ))}
                </motion.div>
            )}

            {/* Selected confirmation */}
            {phase === "selecting" && selectedMaker && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-6 text-center"
                >
                    <div className="flex items-center justify-center gap-2 text-emerald-400 font-bold">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Connecting to Maker...
                    </div>
                </motion.div>
            )}
        </div>
    );
}
