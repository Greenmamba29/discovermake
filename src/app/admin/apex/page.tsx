"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
    Activity,
    Zap,
    Shield,
    Bell,
    DollarSign,
    Users,
    Bug,
    Map as MapIcon,
    Search,
    ShieldAlert,
    Terminal,
    Lock,
    Cpu,
    Network,
    ArrowUpRight
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { AnimatedText, GlassPanel, IronButton, RetroStrata, StatCard, ProgressBar } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";
import { cn } from "@/lib/utils";

/**
 * Hi-Fi Admin Apex: Command Center
 * High-Fidelity Overhaul with Motion Infrastructure
 */

const GlitchOverlay = () => (
    <div className="absolute inset-0 pointer-events-none opacity-20 mix-blend-screen overflow-hidden">
        <motion.div
            animate={{
                x: [-2, 2, -1, 0],
                opacity: [0.1, 0.3, 0.1],
                filter: ["hue-rotate(0deg)", "hue-rotate(90deg)", "hue-rotate(0deg)"]
            }}
            transition={{ duration: 0.2, repeat: Infinity, repeatType: "mirror" }}
            className="absolute inset-0 bg-blue-500/10"
        />
    </div>
);

import { subscribeToAuditLogs, subscribeToSystemStats, seedAdminStats, AuditLog, SystemStats } from "@/lib/admin";
import { toast } from "sonner";

export default function AdminApexDashboard() {
    const router = useRouter();
    const [currentTime, setCurrentTime] = useState("9:41");
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [stats, setStats] = useState<SystemStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }, 1000);

        const unsubLogs = subscribeToAuditLogs((data) => {
            setLogs(data);
        });

        const unsubStats = subscribeToSystemStats((data) => {
            setStats(data);
            setLoading(false);
        });

        return () => {
            clearInterval(timer);
            unsubLogs();
            unsubStats();
        };
    }, []);

    const handleSeed = async () => {
        try {
            await seedAdminStats();
            toast.success("Apex Node Initialized");
        } catch (error) {
            toast.error("Initialization Failure");
        }
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">

            {/* SUBTLE BACKGROUND MOTION */}
            <div className="fixed inset-0 opacity-20 pointer-events-none origin-center scale-150">
                <HeroMotionBackground />
            </div>

            {/* Mobile Status Bar */}
            <div className="w-full flex justify-between items-center px-6 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 z-50 relative border-b border-white/5 bg-[#0B1120]/50 backdrop-blur-md">
                <span>{currentTime}</span>
                <div className="flex space-x-2 items-center">
                    <Activity className="w-3 h-3" />
                    <Zap className="w-3 h-3 fill-current" />
                    <div className="w-6 h-3 border border-gray-600 rounded-sm flex items-center px-0.5">
                        <div className="w-full h-1.5 bg-emerald-500 rounded-px" />
                    </div>
                </div>
            </div>

            {/* Header */}
            <header className="px-6 pt-6 pb-4 flex justify-between items-center z-20 relative">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-400/30">
                        <Shield className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <AnimatedText
                            text="Admin Command"
                            className="text-2xl font-black tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent"
                        />
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 italic">System Optimal</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <IronButton variant="secondary" size="sm" onClick={handleSeed} className="text-[9px] uppercase font-black italic">Seed Apex</IronButton>
                    <Link href="/admin/approval">
                        <IronButton variant="secondary" size="sm" icon={<Bell className="w-4 h-4" />} className="relative">
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-black flex items-center justify-center text-white ring-2 ring-[#0B1120]">5</span>
                        </IronButton>
                    </Link>
                </div>
            </header>

            <main className="px-6 pb-32 space-y-8 relative z-10 max-w-4xl mx-auto">
                {/* 1. Global Traffic Map */}
                <section className="relative w-full h-80 rounded-[2rem] overflow-hidden shadow-2xl border border-white/5 group">
                    <div className="absolute inset-0 bg-[#0B1120]">
                        <Image
                            src="https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?q=80&w=2000&auto=format&fit=crop"
                            fill
                            className="object-cover opacity-20 grayscale group-hover:scale-105 transition-transform duration-10000"
                            alt="Map"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0B1120]/20 to-[#0B1120]" />
                    </div>

                    <GlitchOverlay />

                    {/* Pulse Points */}
                    <motion.div
                        animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 4, repeat: Infinity }}
                        className="absolute top-1/3 left-1/4 w-4 h-4 bg-blue-500 rounded-full shadow-[0_0_20px_rgba(59,130,246,0.8)]"
                    />
                    {/* Trajectories ... */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
                        <motion.path
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 3, repeat: Infinity }}
                            d="M80 150 Q 150 100, 260 180"
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="1"
                            strokeDasharray="2 4"
                        />
                    </svg>

                    {/* Floating HUD */}
                    <div className="absolute top-6 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white italic">Node Connectivity: 100%</span>
                    </div>
                </section>

                <div className="grid grid-cols-2 gap-4">
                    <StatCard label="Surge Revenue" value={stats?.surgeRevenue || "$0.00"} change="+12.5%" changeType="positive" icon={<DollarSign className="w-5 h-5" />} />
                    <StatCard label="Active Gigs" value={String(stats?.activeGigs || 0)} change="24 active" changeType="neutral" icon={<Users className="w-5 h-5" />} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Security Matrix */}
                    <GlassPanel variant="elevated" className="p-8 rounded-[2.5rem]">
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white mb-6">Security Matrix</h3>
                        <div className="space-y-6">
                            {(stats?.securityMatrix || [
                                { label: 'Handshake Integrity', icon: Shield, value: 0, status: 'Initializing' },
                                { label: 'Clawback Shield', icon: Lock, value: 0, status: 'Initializing' },
                                { label: 'Node Encryption', icon: Cpu, value: 0, status: 'Initializing' }
                            ]).map((item, i) => (
                                <div key={i} className="space-y-3">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest italic">
                                        <span className="text-gray-500 flex items-center gap-2">
                                            {item.label.includes('Shield') ? <Lock size={12} className="text-blue-400" /> : <Shield size={12} className="text-blue-400" />} {item.label}
                                        </span>
                                        <span className="text-blue-400">{item.status}</span>
                                    </div>
                                    <ProgressBar value={item.value} showPercentage={false} variant="default" />
                                </div>
                            ))}
                        </div>
                    </GlassPanel>

                    {/* Bounty Matrix Integration */}
                    <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-purple-500/20 bg-gradient-to-br from-purple-600/5 to-transparent relative group">
                        <Link href="/marketplace/bounty" className="absolute top-0 right-0 p-6 opacity-40 group-hover:opacity-100 transition-opacity">
                            <ArrowUpRight className="text-purple-400 size-6" />
                        </Link>
                        <div className="flex items-center gap-4 mb-6">
                            <div className="size-14 rounded-2xl bg-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                                <Bug className="w-7 h-7 text-white" />
                            </div>
                            <div>
                                <h3 className="text-xl font-black uppercase italic tracking-tighter text-white">Bounty Matrix</h3>
                                <p className="text-[10px] font-black uppercase tracking-widest text-purple-400 italic">Network Integration Active</p>
                            </div>
                        </div>
                        <p className="text-sm text-gray-500 italic leading-relaxed mb-6">
                            Network security is currently monitoring live anomalies across the registry stack. Triage parameters are prioritized.
                        </p>
                        <IronButton variant="secondary" onClick={() => router.push('/marketplace/bounty')} className="w-full h-12 rounded-xl text-[10px] font-black uppercase tracking-widest italic border-purple-500/10 hover:bg-purple-500/10 transition-all">
                            Open Triage Deck
                        </IronButton>
                    </GlassPanel>
                </div>

                {/* Audit Logs */}
                <GlassPanel variant="default" className="p-8 rounded-[2.5rem]">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                            <Terminal size={20} className="text-blue-400" />
                            <h3 className="text-xl font-black uppercase italic tracking-tighter text-white">Real-Time Audit Stream</h3>
                        </div>
                        <RetroStrata label="Live Logs" variant="info" pulse />
                    </div>
                    <div className="space-y-4 font-mono text-[11px]">
                        {loading ? (
                            <div className="flex items-center justify-center py-10 opacity-50 italic">Synchronizing audit stream...</div>
                        ) : logs.length === 0 ? (
                            <div className="flex items-center justify-center py-10 opacity-50 italic">Stream silent. Awaiting network activity.</div>
                        ) : logs.map((log, i) => (
                            <div key={log.id} className="flex gap-4 p-3 rounded-lg bg-white/2 border border-white/5 hover:bg-white/5 transition-colors group">
                                <span className="text-gray-600 group-hover:text-blue-500 transition-colors shrink-0">
                                    {log.timestamp?.toDate()?.toLocaleTimeString() || '00:00:00'}
                                </span>
                                <span className="text-blue-400 font-black shrink-0">[{log.event}]</span>
                                <span className="text-gray-500 italic shrink-0">SOURCE: {log.node}</span>
                                <span className={cn(
                                    "ml-auto font-black italic",
                                    log.status === 'OK' || log.status === 'LOCKED' ? 'text-emerald-500' :
                                        log.status === 'ALERT' ? 'text-red-500' : 'text-amber-500'
                                )}>{log.status}</span>
                            </div>
                        ))}
                    </div>
                </GlassPanel>
            </main>

            <nav className="fixed bottom-0 left-0 right-0 h-20 bg-[#0B1120]/80 backdrop-blur-2xl border-t border-white/5 z-50">
                <div className="max-w-md mx-auto h-full flex items-center justify-around px-2">
                    <button className="flex flex-col items-center gap-1 text-blue-400 group">
                        <MapIcon className="w-5 h-5" />
                        <span className="text-[9px] font-black uppercase italic">Command</span>
                    </button>
                    <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition-colors group">
                        <Search className="w-5 h-5" />
                        <span className="text-[9px] font-black uppercase italic">Inspect</span>
                    </button>
                    <div className="relative -top-8">
                        <button className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-[0_8px_25px_rgba(59,130,246,0.4)] border-4 border-[#0B1120]">
                            <Zap className="w-8 h-8 fill-current" />
                        </button>
                    </div>
                    <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition-colors group">
                        <Bell className="w-5 h-5" />
                        <span className="text-[9px] font-black uppercase italic">Alerts</span>
                    </button>
                    <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition-colors group">
                        <Users className="w-5 h-5" />
                        <span className="text-[9px] font-black uppercase italic">Users</span>
                    </button>
                </div>
            </nav>
        </div>
    );
}
