"use client";

import React, { useState } from "react";
import {
    ArrowLeft,
    Calendar,
    TrendingUp,
    ShoppingBag,
    DollarSign,
    MoreHorizontal,
    ArrowUp,
    BarChart3,
    ArrowRight,
    Search,
    Filter,
    CreditCard,
    Zap,
    Users,
    Settings,
    ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { GlassPanel, StatCard, RetroStrata, IronButton } from "@/components/ui/DesignSystem";

/**
 * US-013: Admin Apex — Command Center Evolution
 * Revenue & Take-Rate Hub
 * Derived from assets/stitch_screens_2/.../revenue_&_take-rate_hub
 */

import { subscribeToSystemStats, SystemStats } from "@/lib/admin";
import { useEffect } from "react";

export default function RevenueHubPage() {
    const [timeFilter, setTimeFilter] = useState("This Month");
    const [stats, setStats] = useState<SystemStats | null>(null);

    useEffect(() => {
        const unsubscribe = subscribeToSystemStats((data) => {
            setStats(data);
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen bg-[#0B0F1A] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
            {/* Background Glow */}
            <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="fixed bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[120px] pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-50 bg-[#0B0F1A]/80 backdrop-blur-xl border-b border-white/5 px-6 py-4">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/admin/apex">
                            <button className="size-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all">
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        </Link>
                        <div>
                            <h1 className="text-xl font-black tracking-tight uppercase italic text-white flex items-center gap-2">
                                <DollarSign className="w-5 h-5 text-blue-500" />
                                Revenue Hub
                            </h1>
                            <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic">DiscoverMake Apex Systems</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="size-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
                            <Calendar className="w-5 h-5" />
                        </button>
                        <IronButton variant="primary" size="sm" className="h-10 px-6">
                            <span className="text-[10px] uppercase font-black italic tracking-widest">Generate Report</span>
                        </IronButton>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-12 space-y-12 pb-32">

                {/* Time Filters */}
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                    {["This Month", "Last Month", "YTD", "All Time"].map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setTimeFilter(filter)}
                            className={`px-6 py-2 rounded-2xl text-[10px] font-black uppercase italic tracking-widest transition-all ${timeFilter === filter
                                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                                : "bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10"
                                }`}
                        >
                            {filter}
                        </button>
                    ))}
                </div>

                {/* KPI Cards */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <GlassPanel variant="subtle" className="p-8 rounded-[2rem] border-white/5 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                            <ShoppingBag className="w-24 h-24 text-white" />
                        </div>
                        <div className="relative z-10 space-y-1">
                            <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic">Total GMV</p>
                            <div className="flex items-baseline gap-2">
                                <h2 className="text-4xl font-black italic tracking-tighter">${((stats?.revenue || 0) * 10 / 1000).toFixed(2)}M</h2>
                                <span className="flex items-center gap-0.5 text-xs font-bold text-emerald-400 mb-1">
                                    <TrendingUp className="w-3 h-3" />
                                    +12.5%
                                </span>
                            </div>
                        </div>
                    </GlassPanel>

                    <GlassPanel variant="glow" className="p-8 rounded-[2rem] border-white/5 relative overflow-hidden bg-gradient-to-br from-blue-600/10 to-transparent">
                        <div className="absolute top-0 right-0 p-8 opacity-10">
                            <BarChart3 className="w-24 h-24 text-blue-500" />
                        </div>
                        <div className="relative z-10 space-y-1">
                            <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest italic">Net Revenue (Take-Rate)</p>
                            <div className="flex items-baseline gap-2">
                                <h2 className="text-4xl font-black italic tracking-tighter text-blue-500">${((stats?.revenue || 0) / 1000).toFixed(1)}k</h2>
                                <RetroStrata label="10% Active" variant="info" className="scale-75 origin-left" />
                            </div>
                        </div>
                    </GlassPanel>
                </section>

                {/* Performance Chart Simulation */}
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <GlassPanel className="lg:col-span-2 p-8 rounded-[2rem] border-white/5 space-y-8">
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-xl font-black uppercase italic tracking-tight">30-Day Velocity</h3>
                                <p className="text-[10px] font-bold text-gray-500 italic mt-1 uppercase tracking-widest">Network Throughput: $4,135/day avg</p>
                            </div>
                            <button className="p-2 text-gray-500 hover:text-white transition-colors">
                                <MoreHorizontal className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Fake Visual Chart */}
                        <div className="h-64 relative">
                            <div className="absolute inset-0 flex items-end justify-between gap-2 px-2">
                                {[30, 45, 35, 60, 55, 75, 70, 85, 90, 80, 95, 100, 85, 70].map((h, i) => (
                                    <div
                                        key={i}
                                        className="flex-1 rounded-t-lg bg-gradient-to-t from-blue-600/20 to-blue-500 transition-all duration-1000"
                                        style={{ height: `${h}%` }}
                                    />
                                ))}
                            </div>
                            <div className="absolute inset-0 border-b border-white/10 flex flex-col justify-between pointer-events-none">
                                {[1, 2, 3, 4].map((_, i) => (
                                    <div key={i} className="w-full border-t border-white/5" />
                                ))}
                            </div>
                        </div>
                    </GlassPanel>

                    <GlassPanel variant="subtle" className="p-8 rounded-[2rem] border-white/5 space-y-6">
                        <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-500 italic">EOM Forecast</h4>
                        <div className="space-y-6">
                            <div>
                                <p className="text-3xl font-black italic tracking-tighter">$145,000</p>
                                <p className="text-[10px] font-bold text-emerald-400 italic uppercase mt-1">On Track to Beat Previous</p>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-black uppercase italic text-gray-500">
                                        <span>Quota Meta</span>
                                        <span>85%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-600 w-[85%] rounded-full shadow-[0_0_10px_rgba(37,99,235,0.5)]" />
                                    </div>
                                </div>
                            </div>
                            <IronButton variant="secondary" className="w-full h-12 text-[10px] uppercase italic tracking-[0.2em] font-black">
                                Expansion Analysis
                            </IronButton>
                        </div>
                    </GlassPanel>
                </section>

                {/* Breakdown & Payouts */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-12">
                    <div className="space-y-8">
                        <h3 className="text-xl font-black uppercase italic tracking-tight">Source Distribution</h3>
                        <div className="space-y-4">
                            <GlassPanel variant="subtle" className="p-5 rounded-3xl border-white/5 flex items-center justify-between group hover:border-blue-500/20 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="size-10 rounded-2xl bg-blue-600/10 text-blue-500 flex items-center justify-center">
                                        <Zap className="w-5 h-5 fill-current" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm">Remix Royalties</p>
                                        <p className="text-[9px] font-black uppercase italic text-gray-500 tracking-widest">Transaction Fees</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-black text-white">$85,200</p>
                                    <p className="text-[9px] font-bold text-emerald-400">68% of total</p>
                                </div>
                            </GlassPanel>

                            <GlassPanel variant="subtle" className="p-5 rounded-3xl border-white/5 flex items-center justify-between group hover:border-emerald-500/20 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="size-10 rounded-2xl bg-emerald-600/10 text-emerald-500 flex items-center justify-center">
                                        <CreditCard className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm">Creator Subscriptions</p>
                                        <p className="text-[9px] font-black uppercase italic text-gray-500 tracking-widest">Recurring Meta</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-black text-white">$39,300</p>
                                    <p className="text-[9px] font-bold text-emerald-400">32% of total</p>
                                </div>
                            </GlassPanel>
                        </div>
                    </div>

                    <div className="space-y-8">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-black uppercase italic tracking-tight">Active Payouts</h3>
                            <RetroStrata label="Action Required" variant="warning" pulse />
                        </div>
                        <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-transparent space-y-6">
                            <div className="flex items-center gap-4">
                                <div className="size-14 rounded-3xl bg-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
                                    <Users className="w-8 h-8 text-white" />
                                </div>
                                <div>
                                    <p className="text-2xl font-black italic tracking-tighter text-white font-mono">$42,000</p>
                                    <p className="text-[10px] font-black uppercase text-orange-400 tracking-widest italic mt-1">142 Makers Waiting Release</p>
                                </div>
                            </div>
                            <IronButton variant="primary" className="w-full h-14 bg-orange-600 hover:bg-orange-500 shadow-orange-500/30">
                                <span className="text-[11px] uppercase font-black italic tracking-widest flex items-center gap-2">
                                    Verify & Dispatch Funds
                                    <ArrowRight className="w-4 h-4" />
                                </span>
                            </IronButton>
                        </GlassPanel>
                    </div>
                </section>
            </main>

            {/* Bottom Nav Simulation */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0B0F1A]/80 backdrop-blur-xl border-t border-white/5 p-6 flex justify-around">
                {[
                    { icon: BarChart3, label: "Apex", active: false, href: "/admin/apex" },
                    { icon: DollarSign, label: "Revenue", active: true, href: "/admin/revenue" },
                    { icon: ShieldCheck, label: "Policy", active: false, href: "/admin/approval" },
                    { icon: Settings, label: "Config", active: false, href: "/settings" }
                ].map((item) => (
                    <Link key={item.label} href={item.href}>
                        <button className={`flex flex-col items-center gap-1.5 group ${item.active ? "text-blue-500" : "text-gray-500"}`}>
                            <item.icon className={`w-5 h-5 ${item.active ? "text-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]" : "group-hover:text-white"} transition-all`} />
                            <span className="text-[9px] font-black uppercase tracking-widest italic">{item.label}</span>
                        </button>
                    </Link>
                ))}
            </nav>
        </div>
    );
}
