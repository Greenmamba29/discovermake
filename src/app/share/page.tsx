"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Share2,
    CheckCircle2,
    Twitter,
    Linkedin,
    Video,
    Eye,
    Copy,
    ExternalLink,
    Image as ImageIcon,
    Sparkles,
    Radio,
    Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * US-012: Social Share & Live Build
 * 
 * - Share completed builds to X/LinkedIn/TikTok
 * - Auto-generated build summary card (OG image)
 * - "Go Live" toggle for Makers to stream builds
 */

interface CompletedBuild {
    id: string;
    title: string;
    description: string;
    makerName: string;
    seekerName: string;
    budget: number;
    completedAt: string;
    techStack: string[];
    stats: { daysToComplete: number; milestones: number; satisfaction: number };
}

const MOCK_BUILD: CompletedBuild = {
    id: "P-078",
    title: "Premium Portfolio Website",
    description: "A stunning, responsive portfolio with dark mode, animated transitions, CMS integration, and contact form. Built with Next.js and deployed to Vercel.",
    makerName: "Alex R.",
    seekerName: "Jordan K.",
    budget: 2000,
    completedAt: "Feb 9, 2026",
    techStack: ["Next.js", "Tailwind", "Framer Motion", "Vercel"],
    stats: { daysToComplete: 12, milestones: 4, satisfaction: 5 },
};

export default function SocialSharePage() {
    const [isLive, setIsLive] = useState(false);
    const [shared, setShared] = useState<Set<string>>(new Set());
    const [showPreview, setShowPreview] = useState(false);

    const handleShare = (platform: string) => {
        setShared((prev) => new Set([...prev, platform]));
        // In production: open share dialog with OG card
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-white">
            <div className="fixed top-1/3 right-0 w-[400px] h-[400px] bg-blue-600/3 rounded-full blur-[150px] pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-40 glass-panel border-b border-white/5">
                <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Share2 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="font-black text-lg tracking-tight">Share & Go Live</p>
                            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest italic">Showcase your builds</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-8">
                {/* Build Summary Card Preview */}
                <div className="mb-8">
                    <h2 className="text-sm font-black text-white/50 uppercase tracking-widest mb-4 italic flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-blue-400" />
                        Build Summary Card
                    </h2>

                    <motion.div
                        className="glass-card rounded-3xl overflow-hidden border-blue-500/10"
                        whileHover={{ scale: 1.005 }}
                    >
                        {/* OG Card Preview */}
                        <div className="bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] p-8 relative overflow-hidden">
                            {/* Decorative elements */}
                            <div className="absolute top-0 right-0 w-40 h-40 bg-purple-500/10 rounded-full blur-[60px]" />
                            <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/10 rounded-full blur-[50px]" />

                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                                        <Sparkles className="w-3 h-3 text-white" />
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-white/40 italic">
                                        Built on DiscoverMake
                                    </span>
                                </div>

                                <h3 className="text-2xl font-black tracking-tight mb-2">{MOCK_BUILD.title}</h3>
                                <p className="text-sm text-white/50 mb-6 max-w-lg">{MOCK_BUILD.description}</p>

                                <div className="flex items-center gap-6">
                                    <div>
                                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Maker</p>
                                        <p className="text-sm font-bold">{MOCK_BUILD.makerName}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Completed</p>
                                        <p className="text-sm font-bold">{MOCK_BUILD.stats.daysToComplete} days</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Rating</p>
                                        <p className="text-sm font-bold">{"⭐".repeat(MOCK_BUILD.stats.satisfaction)}</p>
                                    </div>
                                </div>

                                <div className="flex gap-1.5 mt-4">
                                    {MOCK_BUILD.techStack.map((tech) => (
                                        <span key={tech} className="text-[8px] font-bold uppercase tracking-widest text-purple-300/40 bg-purple-500/10 px-2 py-0.5 rounded-lg italic">
                                            {tech}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Share Actions */}
                        <div className="p-6">
                            <p className="text-xs font-bold text-white/40 mb-4">Share this build:</p>
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { platform: "X (Twitter)", icon: "𝕏", color: "from-gray-700 to-gray-800" },
                                    { platform: "LinkedIn", icon: "in", color: "from-blue-700 to-blue-800" },
                                    { platform: "TikTok", icon: "♪", color: "from-pink-600 to-purple-700" },
                                ].map(({ platform, icon, color }) => (
                                    <Button
                                        key={platform}
                                        onClick={() => handleShare(platform)}
                                        className={cn(
                                            "h-12 rounded-xl font-bold text-sm transition-all",
                                            shared.has(platform)
                                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                                                : `bg-gradient-to-r ${color} text-white hover:opacity-90`
                                        )}
                                    >
                                        {shared.has(platform) ? (
                                            <><CheckCircle2 className="w-4 h-4 mr-1" /> Shared!</>
                                        ) : (
                                            <><span className="text-lg mr-2">{icon}</span> {platform}</>
                                        )}
                                    </Button>
                                ))}
                            </div>

                            <div className="flex gap-2 mt-3">
                                <Button
                                    variant="ghost"
                                    className="flex-1 h-10 rounded-xl border border-white/10 text-white/40 text-xs font-bold"
                                    onClick={() => navigator.clipboard.writeText(`https://discovermake.com/builds/${MOCK_BUILD.id}`)}
                                >
                                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy Link
                                </Button>
                                <Button
                                    variant="ghost"
                                    className="flex-1 h-10 rounded-xl border border-white/10 text-white/40 text-xs font-bold"
                                >
                                    <ExternalLink className="w-3.5 h-3.5 mr-1" /> View Live
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Go Live Section */}
                <div className="glass-card rounded-3xl p-6 border-red-500/10">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                                isLive ? "bg-red-500 shadow-lg shadow-red-500/30" : "bg-white/5"
                            )}>
                                <Radio className={cn("w-5 h-5", isLive ? "text-white" : "text-white/30")} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black tracking-tight">Go Live</h3>
                                <p className="text-[10px] text-white/30 font-medium">Stream your build process in real-time</p>
                            </div>
                        </div>

                        <button
                            onClick={() => setIsLive(!isLive)}
                            className={cn(
                                "relative w-14 h-7 rounded-full transition-colors",
                                isLive ? "bg-red-500" : "bg-white/10"
                            )}
                        >
                            <motion.div
                                className="absolute top-1 w-5 h-5 rounded-full bg-white shadow"
                                animate={{ left: isLive ? "calc(100% - 24px)" : "4px" }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>
                    </div>

                    <AnimatePresence>
                        {isLive && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="mt-4 pt-4 border-t border-white/5">
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                        <span className="text-xs font-black text-red-400 italic uppercase tracking-widest">Live Now</span>
                                    </div>

                                    <div className="bg-black/30 rounded-2xl aspect-video flex items-center justify-center mb-4 border border-white/5">
                                        <div className="text-center">
                                            <Video className="w-12 h-12 text-white/10 mx-auto mb-2" />
                                            <p className="text-xs text-white/20 font-medium">Screen sharing active</p>
                                            <p className="text-[10px] text-white/10">Seekers can watch your build in real-time</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4 text-[10px] text-white/30 font-medium">
                                            <span className="flex items-center gap-1">
                                                <Eye className="w-3 h-3" /> 12 watching
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Globe className="w-3 h-3" /> Public
                                            </span>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-red-400 text-[10px] font-bold rounded-lg hover:bg-red-500/10"
                                            onClick={() => setIsLive(false)}
                                        >
                                            Stop Stream
                                        </Button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {!isLive && (
                        <p className="text-[10px] text-white/20 italic mt-2">
                            Go live to let Seekers watch your coding process. Builds trust and showcases your skills.
                        </p>
                    )}
                </div>
            </main>
        </div>
    );
}
