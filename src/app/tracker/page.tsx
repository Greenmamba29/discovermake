"use client";

import React, { useState, useEffect } from "react";
import {
    ArrowLeft,
    Shield,
    MessageSquare,
    Phone,
    Star,
    Zap,
    Cpu,
    MapPin,
    Clock,
    MoreVertical,
    CheckCircle2,
    Activity
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel, RetroStrata, IronButton } from "@/components/ui/DesignSystem";
import Image from "next/image";

/**
 * US-014: Seeker Hub — Live Development Tracker
 * Derived from assets/rider_home_map/.../live_trip_tracking
 */

export default function DevelopmentTrackerPage() {
    const [progress, setProgress] = useState(65);
    const [status, setStatus] = useState("Architecting Logic...");

    useEffect(() => {
        const timer = setInterval(() => {
            setProgress(prev => (prev < 90 ? prev + 0.5 : prev));
        }, 3000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="min-h-screen bg-[#0B1120] text-white font-sans overflow-hidden selection:bg-blue-500/30">
            {/* Full-bleed Map/Network Background */}
            <div className="absolute inset-0 z-0">
                <Image
                    src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2000"
                    alt="Network Grid"
                    fill
                    className="object-cover opacity-20"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-[#0B1120]/40 via-transparent to-[#0B1120]" />

                {/* Simulated Pings */}
                <div className="absolute top-[45%] left-[55%] -translate-x-1/2 -translate-y-1/2">
                    <div className="relative flex items-center justify-center">
                        <motion.div
                            animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute w-24 h-24 bg-blue-500/20 rounded-full"
                        />
                        <div className="relative bg-blue-600 p-4 rounded-[1.5rem] shadow-[0_0_30px_rgba(37,99,235,0.5)] border border-white/20">
                            <Cpu className="w-8 h-8 text-white" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Top Navigation Bar */}
            <div className="relative z-10 flex items-center justify-between p-8 pt-12">
                <Link href="/orchestrator">
                    <button className="size-12 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </Link>
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 px-6 py-2 rounded-full flex items-center gap-3">
                    <div className="size-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,1)]" />
                    <span className="text-[10px] font-black tracking-[0.2em] uppercase italic text-white/80">Refinery Active</span>
                </div>
                <button className="size-12 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-center text-blue-400 hover:bg-white/10 transition-all">
                    <Shield className="w-5 h-5" />
                </button>
            </div>

            {/* Bottom Content Area */}
            <div className="absolute inset-x-0 bottom-0 z-10 p-8 space-y-6">

                {/* Communication Actions */}
                <div className="flex justify-center gap-4">
                    <button className="flex items-center gap-3 px-8 py-3 rounded-full bg-white/5 backdrop-blur-2xl border border-white/10 hover:bg-white/10 transition-all group">
                        <MessageSquare className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-black uppercase italic tracking-widest">Message Maker</span>
                    </button>
                    <button className="flex items-center gap-3 px-8 py-3 rounded-full bg-white/5 backdrop-blur-2xl border border-white/10 hover:bg-white/10 transition-all group">
                        <Activity className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-black uppercase italic tracking-widest">Debug Console</span>
                    </button>
                </div>

                {/* Main Trip Details Card */}
                <GlassPanel variant="glow" className="w-full rounded-[2.5rem] p-10 border-white/10 overflow-hidden relative">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                    <div className="flex items-start justify-between mb-8">
                        <div>
                            <h1 className="text-4xl font-black tracking-tighter italic uppercase text-white">ETA: 4 MINUTES</h1>
                            <p className="text-gray-400 text-sm italic font-medium mt-1">Live Deployment: <span className="text-blue-400">#DM-8829-X</span></p>
                        </div>
                        <div className="text-right">
                            <RetroStrata label="Bounty: $42.00" variant="info" pulse />
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-white/5 h-3 rounded-full mb-10 relative overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            className="h-full bg-blue-600 rounded-full shadow-[0_0_20px_rgba(37,99,235,0.6)]"
                        />
                    </div>

                    {/* Maker Module */}
                    <div className="flex items-center gap-6 pt-6 border-t border-white/5">
                        <div className="relative">
                            <div className="size-20 rounded-[1.5rem] overflow-hidden border-2 border-blue-500/30 p-1 bg-[#0B1120]">
                                <Image
                                    src="https://i.pravatar.cc/200?u=maker-1"
                                    alt="Maker"
                                    width={80}
                                    height={80}
                                    className="rounded-[1.2rem] object-cover"
                                />
                            </div>
                            <div className="absolute -bottom-2 -right-2 bg-blue-600 size-7 rounded-2xl flex items-center justify-center border-4 border-[#0B1120]">
                                <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-xl font-black uppercase italic tracking-tight">Alex Rivera</h3>
                                <div className="flex items-center gap-1.5 text-amber-400">
                                    <Star className="w-4 h-4 fill-current" />
                                    <span className="text-sm font-black">4.98</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest italic">Senior Architect</p>
                                <div className="size-1 rounded-full bg-gray-700" />
                                <p className="text-blue-500 text-[10px] font-black uppercase tracking-widest italic font-mono">ID: BUG-BTY</p>
                            </div>
                        </div>
                    </div>

                    {/* Pull Up Indicator */}
                    <div className="flex justify-center mt-8">
                        <div className="h-1.5 w-16 bg-white/10 rounded-full" />
                    </div>
                </GlassPanel>
            </div>
        </div>
    );
}
