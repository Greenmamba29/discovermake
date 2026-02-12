"use client";

import React from "react";
import { motion } from "framer-motion";
import { Search, RotateCcw, ChevronLeft, ChevronRight, Plus, Share, Layout, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrowserMockupProps {
    children: React.ReactNode;
    url?: string;
    className?: string;
    title?: string;
}

export function BrowserMockup({
    children,
    url = "https://discovermake.com/dashboard",
    className,
    title = "DiscoverMake Dashboard",
}: BrowserMockupProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className={cn(
                "relative rounded-xl overflow-hidden glass-card border border-white/10 shadow-2xl",
                className
            )}
        >
            {/* Browser Header / Controls */}
            <div className="bg-[#1e293b]/80 backdrop-blur-md border-b border-white/5 p-3 flex items-center gap-4">
                {/* Navigation Dots */}
                <div className="flex gap-1.5 px-1">
                    <div className="w-3 h-3 rounded-full bg-red-400/80 shadow-[0_0_8px_rgba(248,113,113,0.3)]" />
                    <div className="w-3 h-3 rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.3)]" />
                    <div className="w-3 h-3 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.3)]" />
                </div>

                {/* Back/Forward/Reload */}
                <div className="flex items-center gap-1">
                    <button className="p-1.5 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Address Bar */}
                <div className="flex-1 max-w-2xl mx-auto">
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-black/40 rounded-full border border-white/5 group focus-within:border-blue-500/50 transition-all">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[11px] font-medium text-white/40 select-none">
                            {url}
                        </span>
                    </div>
                </div>

                {/* Extra Actions */}
                <div className="flex items-center gap-1">
                    <button className="p-1.5 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
                        <Share className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
                        <Plus className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
                        <Layout className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Browser Tab (Visual element) */}
            <div className="px-4 py-2 bg-gradient-to-b from-[#1e293b]/50 to-transparent flex items-center">
                <div className="bg-[#0f172a] rounded-t-lg px-4 py-2 flex items-center gap-2 border-x border-t border-white/5 -mb-[9px] relative z-10">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-[10px] font-bold text-white/80 whitespace-nowrap">
                        {title}
                    </span>
                    <Plus className="w-3 h-3 text-white/30 rotate-45 ml-2 cursor-pointer hover:text-white transition-colors" />
                </div>
                <div className="flex-1 border-b border-white/5" />
            </div>

            {/* Content Area */}
            <div className="relative bg-[#0f172a] h-[500px] overflow-y-auto custom-scrollbar">
                {children}

                {/* Subtle Overlay Glows */}
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
                    <div className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 bg-blue-500/10 blur-[120px]" />
                    <div className="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 bg-purple-500/10 blur-[120px]" />
                </div>
            </div>
        </motion.div>
    );
}
