"use client";

import React from 'react';
import {
    Shield,
    Zap,
    Search,
    Filter,
    ChevronRight,
    Target,
    AlertTriangle,
    CheckCircle2,
    Lock,
    Plus
} from 'lucide-react';
import { GlassPanel, IronButton, RetroStrata, DesignSystem } from '@/components/ui/DesignSystem';
import { cn } from '@/lib/utils';
import Link from 'next/link';

import { subscribeToOpenBounties, Bounty } from '@/lib/bounties';
import { useState, useEffect } from 'react';

export default function BountyGrid() {
    const [bounties, setBounties] = useState<Bounty[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = subscribeToOpenBounties((data) => {
            setBounties(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);
    return (
        <div className="flex-1 p-8 bg-[#0B1120] min-h-screen text-[#e8e8f0]">
            {/* Background Aura */}
            <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-emerald-600/5 rounded-full blur-[150px] pointer-events-none" />

            <header className="flex justify-between items-end mb-12 relative z-10">
                <div>
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-500 mb-2 italic">Protocol Security</h2>
                    <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white">Registry Bounties</h1>
                </div>
                <Link href="/marketplace/bounty/create">
                    <IronButton variant="primary" size="lg" icon={<Target size={20} />} className="bg-emerald-600 border-emerald-500 hover:from-emerald-500 hover:to-emerald-600 shadow-emerald-500/20">
                        Signal Issue
                    </IronButton>
                </Link>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 relative z-10">
                {/* Search & Filters */}
                <div className="xl:col-span-1 space-y-6">
                    <GlassPanel variant="subtle" className="p-6 rounded-3xl">
                        <div className="relative mb-6">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 size-4" />
                            <input
                                type="text"
                                placeholder="Search Protocols..."
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm italic focus:border-emerald-500/50 outline-none transition-all placeholder:text-gray-600"
                            />
                        </div>
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic mb-2">Severity Level</h4>
                            {['Critical', 'High', 'Medium', 'Low'].map(level => (
                                <label key={level} className="flex items-center gap-3 group cursor-pointer">
                                    <div className="size-4 rounded-md border border-white/10 bg-white/5 group-hover:border-emerald-500/50 transition-all flex items-center justify-center">
                                        <div className="size-1.5 bg-emerald-500 rounded-full opacity-0 group-aria-checked:opacity-100" />
                                    </div>
                                    <span className="text-sm italic text-gray-400 group-hover:text-white transition-colors">{level}</span>
                                </label>
                            ))}
                        </div>
                    </GlassPanel>

                    <GlassPanel variant="glow" className="p-8 rounded-3xl border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent">
                        <Shield className="text-emerald-500 size-12 mb-6" />
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white mb-3">Sovereign Protection</h3>
                        <p className="text-xs text-gray-400 italic leading-relaxed">
                            Contribute to the network stability. Every approved fix strengthens the protocol and yields immediate credit allocation.
                        </p>
                    </GlassPanel>
                </div>

                {/* Bounty List */}
                <div className="xl:col-span-3 space-y-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Zap className="animate-spin text-emerald-500 size-10" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Scanning network for bounties...</p>
                        </div>
                    ) : bounties.length === 0 ? (
                        <GlassPanel variant="subtle" className="p-20 text-center rounded-[2.5rem] border-dashed border-white/5">
                            <Shield className="size-16 text-gray-700 mx-auto mb-6 opacity-20" />
                            <h3 className="text-2xl font-black uppercase italic text-gray-600 mb-2">Registry Silent</h3>
                            <p className="text-gray-500 italic mb-8">No active security exploits detected in local sectors.</p>
                            <Link href="/marketplace/bounty/create">
                                <IronButton variant="primary" size="lg" icon={<Plus size={16} />}>
                                    Initialize Signal
                                </IronButton>
                            </Link>
                        </GlassPanel>
                    ) : (
                        bounties.map((bounty, i) => (
                            <GlassPanel key={bounty.id} variant="elevated" className="p-8 rounded-[2.5rem] group hover:border-emerald-500/20 transition-all relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-6 flex flex-col items-end gap-2 text-right">
                                    <p className="text-sm font-black text-emerald-400 italic tracking-tighter">{bounty.reward.toLocaleString()} Credits</p>
                                    <RetroStrata label={bounty.severity} variant={bounty.severity === 'Critical' ? 'error' : bounty.severity === 'High' ? 'warning' : 'info'} />
                                </div>

                                <div className="flex items-start gap-6 mb-6">
                                    <div className="size-16 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 group-hover:border-emerald-500/30 transition-colors bg-gradient-to-br from-emerald-500/10 to-transparent">
                                        <Zap className="text-emerald-400 size-7" />
                                    </div>
                                    <div className="max-w-xl">
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="text-[10px] font-black text-emerald-500 tracking-widest uppercase italic">B-{bounty.id.slice(-4).toUpperCase()}</span>
                                            <h3 className="text-2xl font-black uppercase italic tracking-tighter text-white">{bounty.title}</h3>
                                        </div>
                                        <p className="text-sm text-gray-400 italic leading-relaxed line-clamp-2">{bounty.description}</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-6 border-t border-white/5">
                                    <div className="flex gap-2">
                                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-600 border border-white/5 px-2 py-1 rounded-md">Protocol</span>
                                        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-600 border border-emerald-500/10 bg-emerald-500/5 px-2 py-1 rounded-md">Security</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-[10px] font-black text-gray-500 italic uppercase tracking-widest">Expires in: 48h</span>
                                        <Link href={`/marketplace/bounty/${bounty.id}`}>
                                            <IronButton variant="secondary" size="md" className="rounded-xl border-white/5 bg-white/5 group-hover:bg-emerald-500/10 group-hover:text-emerald-400 transition-all">
                                                Analyze Spec
                                            </IronButton>
                                        </Link>
                                    </div>
                                </div>
                            </GlassPanel>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
