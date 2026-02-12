"use client";

import { useUserData } from "@/hooks/use-user-data";
import { useAuth } from "@/components/auth-provider";
import { Loader2, Settings, Heart, Download, ExternalLink, Sparkles } from "lucide-react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AnimatedText, GlassPanel, IronButton, StatCard } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";
import { motion } from "framer-motion";

export default function DashboardPage() {
    const { user } = useAuth();
    const { userData, loading: fetchingData } = useUserData();
    const [purchasedTemplates, setPurchasedTemplates] = useState<any[]>([]);
    const [blueprints, setBlueprints] = useState<any[]>([]);
    const [loadingPurchases, setLoadingPurchases] = useState(true);

    useEffect(() => {
        const fetchUserData = async () => {
            if (!user) {
                setLoadingPurchases(false);
                return;
            }
            try {
                // Fetch Purchases
                const pQ = query(collection(db, "purchases"), where("uid", "==", user.uid));
                const pSnap = await getDocs(pQ);
                setPurchasedTemplates(pSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                // Fetch Blueprints
                const bQ = query(collection(db, "blueprints"), where("uid", "==", user.uid));
                const bSnap = await getDocs(bQ);
                setBlueprints(bSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                console.error("Error fetching dashboard data:", error);
            } finally {
                setLoadingPurchases(false);
            }
        };
        fetchUserData();
    }, [user]);

    if (fetchingData || loadingPurchases) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0B1120]">
                <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
            </div>
        );
    }

    return (
        <ProtectedRoute>
            <main className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">

                {/* SUBTLE BACKGROUND MOTION */}
                <div className="fixed inset-0 opacity-10 pointer-events-none origin-center scale-110">
                    <HeroMotionBackground />
                </div>

                <div className="max-w-6xl mx-auto px-6 py-12 space-y-12 relative z-10">
                    {/* Header */}
                    <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <AnimatedText
                                text="Client Dashboard"
                                className="text-4xl font-black text-white tracking-tight mb-2"
                            />
                            <p className="text-gray-500 font-medium italic">Welcome back, {user?.displayName || user?.email}</p>
                        </div>
                        <div className="flex gap-4">
                            <Link href="/templates">
                                <IronButton variant="secondary" size="sm">Browse Market</IronButton>
                            </Link>
                            <Link href="/settings">
                                <IronButton variant="primary" size="sm" icon={<Settings className="w-4 h-4" />}>Settings</IronButton>
                            </Link>
                        </div>
                    </header>

                    {/* Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <StatCard
                            label="Total Downloads"
                            value={String(userData?.downloads || 0)}
                            icon={<Download className="w-5 h-5" />}
                        />
                        <StatCard
                            label="Saved Templates"
                            value={String(userData?.saved_templates?.length || 0)}
                            icon={<Heart className="w-5 h-5" />}
                        />
                        <StatCard
                            label="Tier"
                            value={userData?.subscription || "Free"}
                            icon={<Sparkles className="w-5 h-5" />}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Templates */}
                        <div className="lg:col-span-2 space-y-8">
                            <GlassPanel variant="glow" className="p-8">
                                <h2 className="text-xl font-black text-white mb-6 flex items-center gap-3 italic">
                                    <Download className="w-6 h-6 text-blue-500" />
                                    Purchased Assets
                                </h2>

                                {purchasedTemplates.length === 0 ? (
                                    <div className="p-12 text-center text-gray-500 bg-black/20 rounded-2xl border border-dashed border-white/5">
                                        <p className="mb-4">No purchases yet.</p>
                                        <Link href="/templates">
                                            <span className="text-blue-500 hover:underline font-black uppercase text-xs italic">Explore Marketplace &rarr;</span>
                                        </Link>
                                    </div>
                                ) : (
                                    <div className="grid gap-4">
                                        {purchasedTemplates.map((purchase, i) => (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: i * 0.1 }}
                                                key={i}
                                                className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 hover:border-blue-500/30 transition-all group"
                                            >
                                                <div>
                                                    <h3 className="font-bold text-white group-hover:text-blue-400 transition-colors uppercase text-sm tracking-tight">{purchase.templateId.replace(/-/g, ' ')}</h3>
                                                    <p className="text-[10px] font-black uppercase text-gray-500 italic mt-1">Acquired {new Date(purchase.createdAt?.toDate?.() || Date.now()).toLocaleDateString()}</p>
                                                </div>
                                                <Link href={`/templates/${purchase.templateId}`}>
                                                    <IronButton variant="ghost" size="sm" icon={<ExternalLink className="w-3 h-3" />}>Open</IronButton>
                                                </Link>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                            </GlassPanel>

                            {/* Blueprints */}
                            <GlassPanel variant="elevated" className="p-8">
                                <h2 className="text-xl font-black text-white mb-6 flex items-center gap-3 italic">
                                    <Sparkles className="w-6 h-6 text-purple-500" />
                                    AI Blueprints
                                </h2>

                                {blueprints.length === 0 ? (
                                    <div className="p-12 text-center text-gray-500 bg-black/20 rounded-2xl border border-dashed border-white/5">
                                        <Link href="/architect">
                                            <span className="text-purple-500 hover:underline font-black uppercase text-xs italic">Consult AI Architect &rarr;</span>
                                        </Link>
                                    </div>
                                ) : (
                                    <div className="grid gap-4">
                                        {blueprints.map((bp, i) => (
                                            <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 hover:border-purple-500/30 transition-all group">
                                                <div>
                                                    <h3 className="font-bold text-white group-hover:text-purple-400 transition-colors uppercase text-sm tracking-tight">{bp.name || "Custom Architecture"}</h3>
                                                    <p className="text-[10px] font-black uppercase text-gray-500 italic mt-1">Generated {new Date(bp.createdAt?.toDate?.() || bp.timestamp).toLocaleDateString()}</p>
                                                </div>
                                                <Link href={`/architect?id=${bp.id}`}>
                                                    <IronButton variant="ghost" size="sm" icon={<ExternalLink className="w-3 h-3" />}>View</IronButton>
                                                </Link>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </GlassPanel>
                        </div>

                        {/* Profile */}
                        <div className="space-y-6">
                            <GlassPanel variant="subtle" className="p-8">
                                <h2 className="font-black text-white uppercase tracking-widest text-[10px] italic mb-6">Security Profile</h2>
                                <div className="space-y-6">
                                    <div className="p-4 bg-black/20 rounded-xl border border-white/5">
                                        <label className="text-[10px] font-black text-gray-500 uppercase italic mb-1 block tracking-wider">Auth Node</label>
                                        <p className="text-sm font-bold text-white break-all">{user?.email}</p>
                                    </div>
                                    <div className="p-4 bg-black/20 rounded-xl border border-white/5">
                                        <label className="text-[10px] font-black text-gray-500 uppercase italic mb-1 block tracking-wider">Access Level</label>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                            <p className="text-sm font-bold text-white uppercase italic tracking-tighter">{userData?.subscription || "Free Tier"}</p>
                                        </div>
                                    </div>
                                    <Link href="/settings" className="block w-full">
                                        <IronButton variant="secondary" className="w-full text-xs uppercase italic font-black">Configure Node</IronButton>
                                    </Link>
                                </div>
                            </GlassPanel>
                        </div>
                    </div>
                </div>
            </main>
        </ProtectedRoute>
    );
}
