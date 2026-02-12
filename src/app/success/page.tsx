"use client";

import React, { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
    CheckCircle2,
    Download,
    ArrowRight,
    Rocket,
    ShieldCheck,
    Zap,
    LayoutGrid
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { GlassPanel, IronButton, RetroStrata } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";

import { Suspense } from "react";

function SuccessContent() {
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const templateId = searchParams.get('templateId') || 'premium-template';
    const templateName = templateId.replace(/-/g, ' ');

    return (
        <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative flex flex-col justify-center items-center p-6">
            {/* Ambient Background */}
            <div className="fixed inset-0 opacity-[0.05] pointer-events-none">
                <HeroMotionBackground />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-2xl w-full relative z-10"
            >
                <GlassPanel variant="glow" className="p-12 rounded-[3rem] border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent text-center relative overflow-hidden">
                    {/* Decorative Elements */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-blue-500" />
                    <div className="absolute top-10 right-10 opacity-10">
                        <Rocket size={120} className="text-emerald-500" />
                    </div>

                    <div className="size-24 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                        <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                    </div>

                    <h1 className="text-4xl font-black uppercase italic tracking-tighter text-white mb-4">Protocol Genesis Successful</h1>
                    <p className="text-gray-400 text-lg italic mb-8 max-w-md mx-auto">
                        High-fidelity acquisition of <span className="text-white capitalize">&quot;{templateName}&quot;</span> is confirmed. Your node is now authorized.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                        <GlassPanel variant="subtle" className="p-4 rounded-2xl flex items-center gap-4 border-white/5">
                            <ShieldCheck className="text-emerald-400 size-6" />
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">License</p>
                                <p className="text-xs font-bold text-white italic">Sovereign Commercial</p>
                            </div>
                        </GlassPanel>
                        <GlassPanel variant="subtle" className="p-4 rounded-2xl flex items-center gap-4 border-white/5">
                            <Zap className="text-blue-400 size-6" />
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Status</p>
                                <p className="text-xs font-bold text-white italic">Deployed to Library</p>
                            </div>
                        </GlassPanel>
                    </div>

                    <div className="space-y-4">
                        <IronButton
                            variant="primary"
                            size="lg"
                            className="w-full h-16 text-sm uppercase italic border border-emerald-400/50 shadow-emerald-500/20"
                            asChild
                        >
                            <a href={`/api/download?template=${templateId}`} download>
                                <Download className="mr-3 h-5 w-5" /> Download Blueprint Package
                            </a>
                        </IronButton>

                        <div className="flex gap-4">
                            <IronButton
                                variant="secondary"
                                className="flex-1 h-14 text-xs uppercase italic"
                                asChild
                            >
                                <Link href="/dashboard/client">
                                    <LayoutGrid className="mr-2 h-4 w-4" /> To Dashboard
                                </Link>
                            </IronButton>
                            <IronButton
                                variant="secondary"
                                className="flex-1 h-14 text-xs uppercase italic"
                                asChild
                            >
                                <Link href="/marketplace">
                                    Explore More <ArrowRight className="ml-2 h-4 w-4" />
                                </Link>
                            </IronButton>
                        </div>
                    </div>

                    <div className="mt-12 flex items-center justify-center gap-2 opacity-40">
                        <div className="size-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Connected to Sovereign Mesh</span>
                    </div>
                </GlassPanel>
            </motion.div>
        </div>
    );
}

export default function SuccessPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
                <div className="size-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
        }>
            <SuccessContent />
        </Suspense>
    );
}

