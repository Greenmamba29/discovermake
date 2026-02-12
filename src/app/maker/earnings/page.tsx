"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    DollarSign,
    TrendingUp,
    CheckCircle2,
    Clock,
    Upload,
    ChevronDown,
    ArrowUpRight,
    Wallet,
    Calendar,
    Star,
    Zap,
    ArrowLeft,
    Rocket
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { GlassPanel, IronButton, RetroStrata, RetroStrataVariant } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";

/**
 * US-015: Maker Hub — Earnings & Financials
 * Augmented with Aura & Iron aesthetic + Stripe Connect
 */

interface Milestone {
    id: string;
    title: string;
    status: "pending" | "in-progress" | "delivered" | "approved" | "paid";
    amount: number;
    dueDate: string;
    deliveredAt?: string;
    paidAt?: string;
}

interface EarningsPeriod {
    label: string;
    amount: number;
    projects: number;
    change: number;
}

const MOCK_MILESTONES: Milestone[] = [
    { id: "ms1", title: "Project Setup & Architecture", status: "paid", amount: 800, dueDate: "Jan 15", deliveredAt: "Jan 14", paidAt: "Jan 21" },
    { id: "ms2", title: "Frontend MVP", status: "approved", amount: 1200, dueDate: "Jan 29", deliveredAt: "Jan 28" },
    { id: "ms3", title: "Backend API & Database", status: "delivered", amount: 1400, dueDate: "Feb 12", deliveredAt: "Feb 10" },
    { id: "ms4", title: "Testing & QA", status: "in-progress", amount: 600, dueDate: "Feb 19" },
    { id: "ms5", title: "Deploy & Handoff", status: "pending", amount: 500, dueDate: "Feb 26" },
];

const EARNINGS_DATA: EarningsPeriod[] = [
    { label: "Net Revenue", amount: 12450, projects: 12, change: 18 },
    { label: "Pending Payout", amount: 3200, projects: 3, change: 5 },
    { label: "Network Fee", amount: 1860, projects: 0, change: 0 },
];

const STATUS_CONFIG: Record<string, { label: string; variant: RetroStrataVariant; color: string }> = {
    pending: { label: "Pending", variant: "subtle", color: "text-gray-500" },
    "in-progress": { label: "In Progress", variant: "info", color: "text-blue-400" },
    delivered: { label: "Delivered", variant: "warning", color: "text-amber-400" },
    approved: { label: "Approved", variant: "success", color: "text-emerald-400" },
    paid: { label: "Paid", variant: "premium", color: "text-purple-400" },
};

import { useAuth } from "@/components/auth-provider";
import { subscribeToMakerMilestones, updateMilestoneStatus, MakerMilestone } from "@/lib/workflows";
import { useEffect } from "react";
import { toast } from "sonner";

export default function MakerEarningsPage() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<"milestones" | "financials">("milestones");
    const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null);
    const [milestones, setMilestones] = useState<MakerMilestone[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;
        const unsubscribe = subscribeToMakerMilestones(user.uid, (data) => {
            setMilestones(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [user]);

    const totalEarned = milestones.filter((m) => m.status === "paid").reduce((sum, m) => sum + m.amount, 0);
    const totalPending = milestones.filter((m) => m.status !== "paid" && m.status !== "pending").reduce((sum, m) => sum + m.amount, 0);
    const totalProject = milestones.reduce((sum, m) => sum + m.amount, 0);

    const handleDeliver = async (milestoneId: string) => {
        try {
            await updateMilestoneStatus(milestoneId, "delivered", "Today");
            toast.success("Milestone Broadcast Successful");
        } catch (error) {
            toast.error("Network Interference Detected");
        }
    };

    const handleConnect = async () => {
        try {
            const response = await fetch('/api/payouts/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: 'test-user-123', // Hardcoded for test
                    email: 'paco@example.com',
                }),
            });
            const data = await response.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                alert(data.error || "Failed to initialize Connect protocol");
            }
        } catch (error) {
            console.error('Connect error:', error);
        }
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
            {/* Background */}
            <div className="fixed inset-0 opacity-[0.03] pointer-events-none origin-center scale-125">
                <HeroMotionBackground />
            </div>

            {/* Header */}
            <header className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-xl border-b border-white/5 py-6">
                <div className="max-w-4xl mx-auto px-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard/maker">
                            <button className="size-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all">
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        </Link>
                        <div>
                            <h1 className="text-xl font-black tracking-tight uppercase italic text-white">Revenue Alpha</h1>
                            <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic">Maker Financial Node</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                            <p className="text-[9px] font-black uppercase text-gray-500 tracking-widest italic">Node Status</p>
                            <p className="text-[10px] font-black uppercase text-emerald-400 italic">Financials Synced</p>
                        </div>
                        <div className="size-10 rounded-full border border-blue-500/30 bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100)' }} />
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-6 py-12 space-y-12 pb-40">
                {/* 1. TOP KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        { label: "Node Revenue", value: `$${totalEarned.toLocaleString()}`, sub: "7d Velocity: +12%", icon: DollarSign, color: "text-emerald-400" },
                        { label: "In Escrow", value: `$${totalPending.toLocaleString()}`, sub: "Awaiting Clearance", icon: Clock, color: "text-amber-400" },
                        { label: "Alpha Potential", value: `$${totalProject.toLocaleString()}`, sub: "Global Index Score", icon: TrendingUp, color: "text-purple-400" }
                    ].map((card, i) => (
                        <GlassPanel key={i} variant="elevated" className="p-8 rounded-[2rem] border-white/5 space-y-4 group hover:border-blue-500/20 transition-all relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                                <card.icon className="w-16 h-16" />
                            </div>
                            <div className="size-10 rounded-xl bg-white/5 flex items-center justify-center">
                                <card.icon className={cn("w-5 h-5", card.color)} />
                            </div>
                            <div>
                                <h3 className="text-3xl font-black text-white italic tracking-tighter">{card.value}</h3>
                                <p className="text-[9px] font-black uppercase text-gray-500 tracking-widest italic mt-1">{card.label}</p>
                            </div>
                            <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase text-emerald-400 italic">{card.sub}</span>
                                <ArrowUpRight className="w-4 h-4 text-gray-700" />
                            </div>
                        </GlassPanel>
                    ))}
                </div>

                {/* 2. STRIPE CONNECT INTEGRATION */}
                <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-blue-500/10 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="size-24 rounded-3xl bg-blue-600/10 flex items-center justify-center relative z-10">
                        <Wallet className="w-12 h-12 text-blue-500" />
                    </div>
                    <div className="flex-1 text-center md:text-left relative z-10">
                        <h2 className="text-2xl font-black tracking-tight uppercase italic text-white mb-2">Payout Infrastructure</h2>
                        <p className="text-gray-500 text-sm leading-relaxed italic max-w-lg mb-6">Connect your Node to Stripe Global for instant clearing and tax compliance. Over $4.2M processed this month.</p>
                        <IronButton
                            variant="primary"
                            className="px-10 h-12 italic uppercase border border-blue-400 shadow-xl shadow-blue-500/20"
                            onClick={handleConnect}
                        >
                            Configure Stripe Connect
                        </IronButton>
                    </div>
                </GlassPanel>


                {/* 3. TABS SECTION */}
                <section className="space-y-8">
                    <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
                        {(["milestones", "financials"] as const).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={cn(
                                    "px-8 py-3 rounded-full text-[10px] font-black uppercase italic tracking-widest transition-all whitespace-nowrap border",
                                    activeTab === tab
                                        ? "bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/20"
                                        : "bg-white/5 border-white/10 text-gray-500 hover:text-gray-300"
                                )}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    <AnimatePresence mode="wait">
                        {activeTab === "milestones" && (
                            <motion.div
                                key="milestones"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                className="space-y-4"
                            >
                                {milestones.map((milestone, i) => {
                                    const config = STATUS_CONFIG[milestone.status];
                                    const isExpanded = expandedMilestone === milestone.id;
                                    const canDeliver = milestone.status === "in-progress";

                                    return (
                                        <GlassPanel
                                            key={milestone.id}
                                            variant="subtle"
                                            className={cn(
                                                "p-6 rounded-[2rem] border-white/5 transition-all overflow-hidden",
                                                milestone.status === "paid" && "opacity-40 grayscale"
                                            )}
                                        >
                                            <div
                                                className="flex flex-col md:flex-row md:items-center justify-between gap-6 cursor-pointer"
                                                onClick={() => setExpandedMilestone(isExpanded ? null : milestone.id)}
                                            >
                                                <div className="flex items-center gap-6">
                                                    <div className="size-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xs font-black italic">
                                                        {String(i + 1).padStart(2, '0')}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-lg font-black text-white italic uppercase tracking-tight group-hover:text-blue-400 transition-colors">
                                                            {milestone.title}
                                                        </h4>
                                                        <div className="flex items-center gap-3 mt-1 text-[10px] font-black uppercase text-gray-500 tracking-widest italic">
                                                            <Calendar className="w-3 h-3" />
                                                            <span>Due: {milestone.dueDate}</span>
                                                            {milestone.deliveredAt && (
                                                                <>
                                                                    <div className="size-1 rounded-full bg-gray-700" />
                                                                    <span className="text-emerald-500">Delivered: {milestone.deliveredAt}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between md:justify-end gap-8">
                                                    <div className="text-right">
                                                        <p className="text-xl font-black italic tracking-tighter text-white">${milestone.amount.toLocaleString()}</p>
                                                        <RetroStrata label={config.label} variant={config.variant} size="sm" className="mt-1" />
                                                    </div>
                                                    <ChevronDown className={cn("w-5 h-5 text-gray-600 transition-transform", isExpanded && "rotate-180")} />
                                                </div>
                                            </div>

                                            <AnimatePresence>
                                                {isExpanded && canDeliver && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: "auto" }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="mt-8 pt-8 border-t border-white/5"
                                                    >
                                                        <IronButton
                                                            variant="primary"
                                                            className="w-full h-14 italic uppercase border border-blue-400 shadow-xl shadow-blue-500/20"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeliver(milestone.id);
                                                            }}
                                                        >
                                                            Broadcast Delivery Milestone
                                                            <Upload className="size-4 ml-2" />
                                                        </IronButton>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </GlassPanel>
                                    );
                                })}
                            </motion.div>
                        )}

                        {activeTab === "financials" && (
                            <motion.div
                                key="financials"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                className="grid grid-cols-1 md:grid-cols-2 gap-6"
                            >
                                {EARNINGS_DATA.map((period, i) => (
                                    <GlassPanel key={i} variant="subtle" className="p-8 rounded-[2rem] border-white/5 group hover:border-white/20 transition-all">
                                        <div className="flex justify-between items-start mb-6">
                                            <div>
                                                <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic mb-2">{period.label}</p>
                                                <h4 className="text-3xl font-black text-white italic tracking-tighter">${period.amount.toLocaleString()}</h4>
                                            </div>
                                            {period.change > 0 && (
                                                <div className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                                                    <span className="text-[10px] font-black text-emerald-400">+{period.change}% Velocity</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-[10px] font-black uppercase text-gray-600 tracking-widest italic">
                                            <Rocket className="w-4 h-4" />
                                            <span>{period.projects || 12} Protocol Deployments</span>
                                        </div>
                                    </GlassPanel>
                                ))}

                                {/* Payout forecast card */}
                                <GlassPanel variant="glow" className="p-8 rounded-[2rem] border-emerald-500/10 md:col-span-2 flex flex-col md:flex-row md:items-center justify-between gap-8">
                                    <div className="flex items-center gap-6">
                                        <div className="size-16 rounded-3xl bg-emerald-500/10 flex items-center justify-center">
                                            <Calendar className="w-8 h-8 text-emerald-500" />
                                        </div>
                                        <div>
                                            <h4 className="text-lg font-black text-white italic uppercase tracking-tight">Active Clearance Forecast</h4>
                                            <p className="text-sm text-gray-500 italic mt-0.5">Estimated release in <span className="text-emerald-400 font-bold">5 Earth Days</span></p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-3xl font-black italic tracking-tighter text-white">$3,200.00</p>
                                        <p className="text-[10px] font-black uppercase text-emerald-500 tracking-widest italic mt-1">Ready for Clearing</p>
                                    </div>
                                </GlassPanel>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </section>
            </main>
        </div>
    );
}
