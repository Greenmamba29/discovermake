"use client";

import React from "react";
import { motion } from "framer-motion";
import {
    ShieldCheck,
    Star,
    Zap,
    Clock,
    CheckCircle,
    MessageSquare,
    TrendingUp,
    Lock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel, RetroStrata } from "@/components/ui/DesignSystem";
import Image from "next/image";

/**
 * US-015: Maker TrustProfile
 * High-fidelity maker profile component inspired by premium ride-sharing credentials.
 */

interface TrustProfileProps {
    maker: {
        name: string;
        avatar: string;
        trustScore: number;
        completedWorkflows: number;
        rating: number;
        memberSince: string;
        isVerified: boolean;
        specialties: string[];
    };
    className?: string;
}

export function TrustProfile({ maker, className }: TrustProfileProps) {
    return (
        <GlassPanel variant="glow" className={cn("p-8 rounded-[2.5rem] border-white/10 space-y-8", className)}>
            {/* Header / Identity */}
            <div className="flex flex-col items-center text-center space-y-4">
                <div className="relative group">
                    <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 group-hover:opacity-40 transition-opacity" />
                    <div className="relative size-24 rounded-[2rem] overflow-hidden border-2 border-blue-500/30">
                        <Image
                            src={maker.avatar}
                            alt={maker.name}
                            fill
                            className="object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                    </div>
                    {maker.isVerified && (
                        <div className="absolute -bottom-2 -right-2 size-8 bg-blue-600 rounded-xl border-4 border-[#0B1120] flex items-center justify-center shadow-lg shadow-blue-500/50">
                            <ShieldCheck className="size-4 text-white" />
                        </div>
                    )}
                </div>
                <div>
                    <h2 className="text-2xl font-black italic tracking-tight text-white uppercase">{maker.name}</h2>
                    <p className="text-[10px] font-black uppercase text-gray-500 tracking-[0.2em] italic mt-1">Foundry Master • Level 5</p>
                </div>
                <div className="flex gap-2">
                    {maker.specialties.map(s => (
                        <RetroStrata key={s} label={s} variant="subtle" size="sm" />
                    ))}
                </div>
            </div>

            {/* Trust Matrix */}
            <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-1">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase text-emerald-400 italic">
                        <ShieldCheck className="size-3" />
                        Trust Score
                    </div>
                    <p className="text-2xl font-black italic text-white tracking-tighter">{maker.trustScore}/100</p>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-1">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase text-blue-400 italic">
                        <Zap className="size-3" />
                        Impact
                    </div>
                    <p className="text-2xl font-black italic text-white tracking-tighter">{maker.completedWorkflows}+</p>
                </div>
            </div>

            {/* Performance Stats */}
            <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                            <Star className="size-4 text-amber-500 fill-amber-500/20" />
                        </div>
                        <span className="text-[10px] font-black uppercase text-gray-400 italic tracking-widest">Global Rating</span>
                    </div>
                    <span className="text-sm font-black text-white italic">{maker.rating} / 5.0</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                            <Clock className="size-4 text-blue-500" />
                        </div>
                        <span className="text-[10px] font-black uppercase text-gray-400 italic tracking-widest">Avg. Delivery</span>
                    </div>
                    <span className="text-sm font-black text-white italic">14.2 Hours</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
                            <TrendingUp className="size-4 text-purple-500" />
                        </div>
                        <span className="text-[10px] font-black uppercase text-gray-400 italic tracking-widest">Network Rank</span>
                        <div className="size-1 rounded-full bg-gray-700" />
                    </div>
                    <span className="text-sm font-black text-white italic">Top 1%</span>
                </div>
            </div>

            {/* Security Badge */}
            <div className="p-4 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center gap-4 group">
                <div className="size-10 rounded-xl bg-blue-600/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Lock className="size-5 text-blue-400" />
                </div>
                <div>
                    <p className="text-[10px] font-black text-white italic uppercase">Verified Sovereign Node</p>
                    <p className="text-[8px] font-black uppercase text-blue-500 tracking-widest italic mt-0.5">Identified via Zero-Knowledge Protocol</p>
                </div>
            </div>
        </GlassPanel>
    );
}
