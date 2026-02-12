"use client";

import React from 'react';
import { useAuth } from '@/components/auth-provider';
import { useRouter } from 'next/navigation';
import {
    Wrench,
    DollarSign,
    Clock,
    CheckCircle2,
    Star,
    Bell,
    ChevronRight,
    Zap,
    MessageSquare,
    ShieldCheck,
    AlertCircle,
    Timer,
    TrendingUp,
    Users,
    Eye,
    Settings,
    LayoutGrid,
    BarChart3
} from 'lucide-react';
import { GlassPanel, IronButton, RetroStrata, ProgressBar, DesignSystem } from '@/components/ui/DesignSystem';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { GigOfferCard } from '@/components/maker-acceptance';

import { subscribeToAvailableGigs, acceptGig, seedTestGigs, Gig } from '@/lib/gigs';
import { toast } from 'sonner';

const MakerDashboard = () => {
    const { user, userData } = useAuth();
    const router = useRouter();
    const verificationStatus = userData?.verificationStatus || 'unverified';
    const [incomingGigs, setIncomingGigs] = React.useState<Gig[]>([]);
    const [loadingGigs, setLoadingGigs] = React.useState(true);

    React.useEffect(() => {
        const unsubscribe = subscribeToAvailableGigs((gigs) => {
            setIncomingGigs(gigs);
            setLoadingGigs(false);
        });
        return () => unsubscribe();
    }, []);

    const handleAccept = async (gigId: string) => {
        if (!user) return;
        try {
            await acceptGig(gigId, user.uid);
            toast.success("Mission Accepted! Added to Forge.");
        } catch (error) {
            console.error("Error accepting gig:", error);
            toast.error("Failed to accept mission.");
        }
    };

    const handleDecline = (gigId: string) => {
        toast.info("Mission Declined. Re-routing signal.");
    };

    const handleSeedData = async () => {
        if (!user) return;
        try {
            await seedTestGigs(user.uid);
            toast.success("Test Gigs Seeded!");
        } catch (error) {
            console.error("Error seeding gigs:", error);
            toast.error("Failed to seed test gigs.");
        }
    };

    return (
        <div className="flex-1 p-8 relative min-h-screen bg-[#0B1120] text-[#e8e8f0]">
            {/* Background Aura */}
            <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[150px] pointer-events-none" />
            <div className="fixed bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />

            <header className="flex justify-between items-end mb-12 relative z-10">
                <div>
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-purple-400 mb-2 italic">Forge Command Center</h2>
                    <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white">
                        {user?.displayName ? `${user.displayName.split(' ')[0]}'s Workshop` : 'The Maker Foundry'}
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    {process.env.NODE_ENV === 'development' && (
                        <IronButton
                            variant="secondary"
                            size="sm"
                            onClick={handleSeedData}
                            className="border-purple-500/30 text-purple-400"
                        >
                            Seed Gigs
                        </IronButton>
                    )}
                    {verificationStatus === 'verified' ? (
                        <RetroStrata label="Tier 1 Maker" variant="premium" pulse />
                    ) : (
                        <button
                            onClick={() => router.push('/onboarding')}
                            className="group relative"
                        >
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full opacity-20 blur group-hover:opacity-40 transition-opacity" />
                            <RetroStrata label="Identity Pending" variant="warning" />
                        </button>
                    )}
                    <IronButton variant="secondary" size="lg" className="rounded-2xl h-14" icon={<Settings size={18} />}>
                        Foundry Settings
                    </IronButton>
                </div>
            </header>

            {/* Performance Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12 relative z-10">
                {[
                    { icon: DollarSign, label: 'Total Revenue', value: '$8,420', variant: 'glow' as const },
                    { icon: Zap, label: 'Live Missions', value: '2', variant: 'default' as const },
                    { icon: Star, label: 'Forge Rating', value: '4.98', variant: 'subtle' as const },
                    { icon: TrendingUp, label: 'Velocity', value: '94%', variant: 'default' as const },
                ].map((stat, i) => (
                    <GlassPanel key={i} variant={stat.variant} className="p-6 rounded-[2rem] group hover:scale-[1.02] transition-all">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="size-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 group-hover:border-purple-500/30 transition-colors">
                                <stat.icon size={18} className="text-purple-400" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">{stat.label}</span>
                        </div>
                        <div className="text-3xl font-black italic tracking-tighter text-white">{stat.value}</div>
                    </GlassPanel>
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 relative z-10">
                {/* Mission Queue (Left/Center) */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white">Incoming Protocol Pings</h3>
                        <div className="flex items-center gap-4">
                            <span className="text-[10px] font-black uppercase tracking-widest text-purple-400 bg-purple-500/10 px-4 py-1.5 rounded-full border border-purple-500/20 italic">
                                {incomingGigs.length} HIGH-MATCH PINGS
                            </span>
                        </div>
                    </div>

                    {loadingGigs ? (
                        <div className="flex justify-center p-12">
                            <Zap className="w-8 h-8 text-purple-500 animate-pulse" />
                        </div>
                    ) : incomingGigs.length === 0 ? (
                        <GlassPanel variant="subtle" className="p-12 text-center rounded-[2.5rem] border-dashed border-white/5">
                            <p className="text-gray-500 italic">Scanning network for compatible missions...</p>
                        </GlassPanel>
                    ) : (
                        incomingGigs.map((gig, i) => (
                            <div key={gig.id} className="relative group">
                                {/* Accent Glow for high match */}
                                {(gig.matchScore || 0) > 90 && (
                                    <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-[2.5rem] opacity-20 blur-sm group-hover:opacity-40 transition-opacity" />
                                )}
                                <GigOfferCard
                                    offer={{
                                        id: gig.id,
                                        projectTitle: gig.title,
                                        description: gig.description,
                                        budget: typeof gig.budget === 'string' ? { min: 0, max: 0 } : gig.budget,
                                        timeline: gig.timeline,
                                        milestones: gig.skills.map((s) => ({ title: s, duration: "3 days" })),
                                        seekerRating: 4.8,
                                        role: "Lead Fabricator",
                                        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                                        teamSize: 1,
                                    }}
                                    onAccept={() => handleAccept(gig.id)}
                                    onDecline={() => handleDecline(gig.id)}
                                />
                            </div>
                        ))
                    )}
                </div>

                {/* Foundry Core (Right) */}
                <div className="space-y-8">
                    <GlassPanel variant="elevated" className="p-8 rounded-[2.5rem]">
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white mb-6">Foundry Mastery</h3>
                        <div className="space-y-6">
                            {[
                                { skill: 'Protocol Logic', icon: Zap, value: 94 },
                                { skill: 'Nexus Interface', icon: Eye, value: 88 },
                                { skill: 'Sovereign Security', icon: ShieldCheck, value: 99 }
                            ].map((item, i) => (
                                <div key={i} className="space-y-2">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest italic">
                                        <span className="text-gray-500 flex items-center gap-2"><item.icon size={12} className="text-purple-400" /> {item.skill}</span>
                                        <span className="text-purple-400">{item.value}%</span>
                                    </div>
                                    <ProgressBar value={item.value} showPercentage={false} variant="default" />
                                </div>
                            ))}
                        </div>
                        <IronButton variant="secondary" className="w-full h-12 rounded-2xl mt-8 text-[10px] font-black uppercase tracking-widest italic" icon={<TrendingUp size={14} />}>
                            Upgrade Skills
                        </IronButton>
                    </GlassPanel>

                    <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:opacity-40 transition-opacity">
                            <LayoutGrid className="size-24 text-emerald-500" />
                        </div>
                        <div className="flex items-center gap-4 mb-4">
                            <div className="size-3 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            <h3 className="text-xl font-black uppercase italic tracking-tighter text-white">Fabricator Visible</h3>
                        </div>
                        <p className="text-sm text-gray-400 italic mb-6 relative z-10">
                            Your node is broadcasting to the Sovereign Network. You are currently visible to <span className="text-white">12,402 Architects</span>.
                        </p>
                        <IronButton variant="secondary" className="w-full h-12 rounded-2xl border-white/10 bg-white/5 opacity-80 hover:opacity-100 transition-all font-black uppercase italic text-[10px] tracking-widest">
                            Go Dark
                        </IronButton>
                    </GlassPanel>

                    <GlassPanel variant="default" className="p-8 rounded-[2.5rem]">
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white mb-6">Financial Ledger</h3>
                        <div className="space-y-4">
                            {[
                                { label: 'Earnings Matrix', icon: BarChart3, path: '/maker/earnings' },
                                { label: 'Payout Registry', icon: DollarSign, path: '/maker/earnings' }
                            ].map((item, i) => (
                                <div
                                    key={i}
                                    onClick={() => router.push(item.path)}
                                    className="flex items-center justify-between p-5 bg-white/2 border border-white/5 rounded-2xl hover:bg-purple-500/5 hover:border-purple-500/20 transition-all cursor-pointer group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="size-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/5 group-hover:bg-purple-500/10 group-hover:border-purple-500/20 transition-all">
                                            <item.icon size={18} className="text-gray-500 group-hover:text-purple-400" />
                                        </div>
                                        <span className="text-sm font-black italic text-white group-hover:text-purple-400 transition-colors uppercase tracking-tight">{item.label}</span>
                                    </div>
                                    <ChevronRight size={16} className="text-gray-700 group-hover:text-purple-500 transition-all" />
                                </div>
                            ))}
                        </div>
                    </GlassPanel>
                </div>
            </div>
        </div>
    );
};

export default MakerDashboard;
