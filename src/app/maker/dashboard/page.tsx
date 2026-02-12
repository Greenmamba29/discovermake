"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    Bell,
    DollarSign,
    TrendingUp,
    Copy,
    Star,
    Sparkles,
    Zap,
    LayoutDashboard,
    FolderOpen,
    Plus,
    Wallet,
    Settings
} from "lucide-react";
import { AnimatedText, GlassPanel, IronButton, RetroStrata, StatCard } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { useUserData } from "@/hooks/use-user-data";
import { ProtectedRoute } from "@/components/protected-route";
import { Loader2, Briefcase, ChevronRight, Check, Database } from "lucide-react";
import { subscribeToAvailableGigs, acceptGig, seedTestGigs, Gig } from "@/lib/gigs";
import { toast } from "sonner";

export default function MakerDashboard() {
    const { user } = useAuth();
    const { userData, loading: fetchingData } = useUserData();
    const [currentTime, setCurrentTime] = useState("9:41");
    const [availableGigs, setAvailableGigs] = useState<Gig[]>([]);
    const [activeGigs, setActiveGigs] = useState<Gig[]>([]);
    const [isLoadingGigs, setIsLoadingGigs] = useState(true);

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!user) return;

        const unsubscribe = subscribeToAvailableGigs((gigs) => {
            setAvailableGigs(gigs.filter(g => g.status === 'open'));
            setActiveGigs(gigs.filter(g => g.status === 'active' && g.id_maker === user.uid));
            setIsLoadingGigs(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleAcceptGig = async (gigId: string) => {
        if (!user) return;
        try {
            await acceptGig(gigId, user.uid);
            toast.success("Mission Accepted", {
                description: "The protocol has been added to your foundry."
            });
        } catch (error) {
            toast.error("Handshake Failure", {
                description: "The registry node refused the connection."
            });
        }
    };

    const handleSeedGigs = async () => {
        if (!user) return;
        try {
            await seedTestGigs(user.uid);
            toast.success("Mission Board Seeded");
        } catch (error) {
            toast.error("Seeding Failed");
        }
    };

    if (fetchingData) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0B1120]">
                <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
            </div>
        );
    }

    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">

                {/* SUBTLE BACKGROUND MOTION */}
                <div className="fixed inset-0 opacity-10 pointer-events-none origin-center scale-125">
                    <HeroMotionBackground />
                </div>

                {/* Header */}
                <header className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-xl border-b border-white/5 px-6 py-4">
                    <div className="max-w-4xl mx-auto flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <motion.div
                                    whileHover={{ scale: 1.1, rotate: 5 }}
                                    className="w-12 h-12 rounded-2xl bg-cover bg-center border border-white/10 shadow-lg"
                                    style={{ backgroundImage: `url(${user?.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100'})` }}
                                />
                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-4 border-[#0B1120]" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Welcome Back,</p>
                                <AnimatedText
                                    text={user?.displayName || (user?.email?.split('@')[0]) || "Maker"}
                                    className="text-xl font-black text-white tracking-tight"
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <IronButton variant="secondary" size="sm" icon={<Bell className="w-4 h-4" />} className="relative">
                                <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full" />
                            </IronButton>
                        </div>
                    </div>
                </header>

                <main className="max-w-4xl mx-auto px-6 pt-8 pb-32 space-y-10 relative z-10">

                    {/* 1. Total Earnings Section */}
                    <section>
                        <div className="flex justify-between items-end mb-4 px-1">
                            <AnimatedText text="Total Earnings" className="text-xl font-black tracking-tight italic" />
                            <Link href="/maker/earnings">
                                <button className="text-[10px] font-black uppercase text-blue-500 italic tracking-widest hover:underline">View Full Report</button>
                            </Link>
                        </div>
                        <GlassPanel variant="glow" className="p-8 border-white/5 shadow-2xl overflow-hidden relative group">
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                                <DollarSign className="w-64 h-64 text-blue-500" />
                            </div>

                            <div className="flex items-start justify-between mb-8 relative z-10">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic mb-2">Available Balance</p>
                                    <h2 className="text-5xl font-black text-white tracking-tight">$12,450.00</h2>
                                </div>
                                <RetroStrata label="+12.5%" variant="success" pulse />
                            </div>

                            <div className="relative h-32 w-full mt-10">
                                <svg className="w-full h-full" viewBox="0 0 400 100" preserveAspectRatio="none">
                                    <defs>
                                        <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.4" />
                                            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                                        </linearGradient>
                                    </defs>
                                    <motion.path
                                        initial={{ d: "M0,100 L400,100", opacity: 0 }}
                                        animate={{ d: "M0,80 Q 50,70 100,50 T 200,60 T 300,20 T 400,10 L 400,100 L 0,100 Z", opacity: 1 }}
                                        transition={{ duration: 1, ease: "easeOut" }}
                                        fill="url(#chartGradient)"
                                    />
                                    <motion.path
                                        initial={{ pathLength: 0 }}
                                        animate={{ pathLength: 1 }}
                                        transition={{ duration: 2, ease: "easeInOut" }}
                                        d="M0,80 Q 50,70 100,50 T 200,60 T 300,20 T 400,10"
                                        fill="none"
                                        stroke="#3B82F6"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                    />
                                    <motion.circle
                                        cx="400" cy="10" r="4" fill="#3B82F6"
                                        animate={{ r: [4, 8, 4], opacity: [1, 0.5, 1] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                    />
                                </svg>
                            </div>
                        </GlassPanel>
                    </section>

                    {/* 2. Available Missions Section */}
                    <section className="space-y-6">
                        <div className="flex justify-between items-end mb-4 px-1">
                            <h2 className="text-xl font-black tracking-tight italic">Available Missions</h2>
                            <RetroStrata label={`${availableGigs.length} Open Nodes`} variant="info" />
                        </div>

                        {isLoadingGigs ? (
                            <div className="flex justify-center py-10">
                                <Loader2 className="animate-spin text-blue-500" />
                            </div>
                        ) : availableGigs.length === 0 ? (
                            <GlassPanel variant="subtle" className="p-8 text-center rounded-3xl border-dashed border-white/5">
                                <p className="text-gray-500 font-medium italic mb-4">No open missions detected in your sector.</p>
                                <IronButton
                                    onClick={handleSeedGigs}
                                    variant="secondary"
                                    size="sm"
                                    icon={<Database size={14} />}
                                >
                                    Seed Mission Board
                                </IronButton>
                            </GlassPanel>
                        ) : (
                            <div className="space-y-4">
                                {availableGigs.map((gig) => (
                                    <GlassPanel key={gig.id} variant="elevated" className="p-6 rounded-[2rem] border-white/5 group hover:border-blue-500/20 transition-all">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                            <div className="flex items-center gap-6">
                                                <div className="size-14 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-400 group-hover:bg-blue-500/20 transition-all">
                                                    <Briefcase size={24} />
                                                </div>
                                                <div>
                                                    <h4 className="text-lg font-black text-white italic uppercase tracking-tight">{gig.title}</h4>
                                                    <p className="text-xs text-gray-500 italic line-clamp-1 mb-2">{gig.description}</p>
                                                    <div className="flex gap-2">
                                                        {gig.skills.slice(0, 3).map((skill, si) => (
                                                            <span key={si} className="text-[8px] font-black uppercase tracking-widest text-blue-500 bg-blue-500/5 px-2 py-0.5 rounded-md border border-blue-500/10">
                                                                {skill}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <p className="text-lg font-black text-white italic tracking-tighter">
                                                        {typeof gig.budget === 'string' ? gig.budget : `$${gig.budget.max}`}
                                                    </p>
                                                    <p className="text-[9px] font-black uppercase text-gray-600 tracking-widest italic">{gig.timeline}</p>
                                                </div>
                                                <IronButton
                                                    onClick={() => handleAcceptGig(gig.id)}
                                                    variant="primary"
                                                    size="sm"
                                                    className="rounded-xl h-10 px-6"
                                                    icon={<ChevronRight size={14} />}
                                                >
                                                    Accept
                                                </IronButton>
                                            </div>
                                        </div>
                                    </GlassPanel>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* 3. Active Protocols Section */}
                    {activeGigs.length > 0 && (
                        <section className="space-y-6">
                            <div className="flex justify-between items-end mb-4 px-1">
                                <h2 className="text-xl font-black tracking-tight italic">Active Protocols</h2>
                            </div>
                            <div className="space-y-4">
                                {activeGigs.map((gig) => (
                                    <GlassPanel key={gig.id} variant="glow" className="p-6 rounded-[2rem] border-emerald-500/10 bg-gradient-to-br from-emerald-500/5 to-transparent">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-6">
                                                <div className="size-12 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400">
                                                    <Zap size={20} />
                                                </div>
                                                <div>
                                                    <h4 className="font-black text-white italic uppercase tracking-tight">{gig.title}</h4>
                                                    <p className="text-[10px] font-black uppercase text-emerald-500 italic tracking-widest">In Foundry • 42% Complete</p>
                                                </div>
                                            </div>
                                            <IronButton variant="secondary" size="sm" className="rounded-xl h-10 bg-white/5 border-white/10">
                                                Registry Console
                                            </IronButton>
                                        </div>
                                    </GlassPanel>
                                ))}
                            </div>
                        </section>
                    )}

                    <section>
                        <div className="flex justify-between items-end mb-4 px-1">
                            <h2 className="text-xl font-black tracking-tight italic">Top Workflows</h2>
                            <Link href="/maker/publish">
                                <button className="text-[10px] font-black uppercase text-blue-500 italic tracking-widest hover:underline flex items-center gap-1">
                                    Publish New <Plus size={12} />
                                </button>
                            </Link>
                        </div>
                        <div className="space-y-3">
                            {[
                                { title: "AI Image Generator v2", runs: "845", earn: "$342", icon: <Sparkles className="w-5 h-5" /> },
                                { title: "Text Summarizer Pro", runs: "620", earn: "$215", icon: <Zap className="w-5 h-5" /> },
                            ].map((wf, i) => (
                                <GlassPanel key={i} variant="subtle" className="py-4 px-5 flex items-center justify-between group hover:border-white/10 transition-all cursor-pointer">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                                            {wf.icon}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white text-sm group-hover:text-blue-400 transition-colors">{wf.title}</h4>
                                            <p className="text-[10px] font-black uppercase italic text-gray-500 tracking-widest mt-1">{wf.runs} runs total</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="block text-sm font-black text-white">{wf.earn}</span>
                                    </div>
                                </GlassPanel>
                            ))}
                        </div>
                    </section>
                </main>

                <nav className="fixed bottom-0 left-0 right-0 h-20 bg-[#0B1120]/80 backdrop-blur-2xl border-t border-white/5 z-50">
                    <div className="max-w-md mx-auto h-full flex items-center justify-around px-2">
                        <button className="flex flex-col items-center gap-1 text-blue-400">
                            <LayoutDashboard className="w-5 h-5" />
                            <span className="text-[9px] font-black uppercase italic">Overview</span>
                        </button>
                        <button className="flex flex-col items-center gap-1 text-gray-500">
                            <FolderOpen className="w-5 h-5" />
                            <span className="text-[9px] font-black uppercase italic">Projects</span>
                        </button>
                        <div className="relative -top-8">
                            <button className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-lg border-4 border-[#0B1120]">
                                <Plus className="w-8 h-8" />
                            </button>
                        </div>
                        <Link href="/maker/earnings">
                            <button className="flex flex-col items-center gap-1 text-gray-500">
                                <Wallet className="w-5 h-5" />
                                <span className="text-[9px] font-black uppercase italic">Wallet</span>
                            </button>
                        </Link>
                        <button className="flex flex-col items-center gap-1 text-gray-500">
                            <Settings className="w-5 h-5" />
                            <span className="text-[9px] font-black uppercase italic">Settings</span>
                        </button>
                    </div>
                </nav>
            </div>
        </ProtectedRoute>
    );
}
