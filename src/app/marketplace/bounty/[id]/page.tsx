"use client";

import React from 'react';
import {
    ChevronLeft,
    Zap,
    Shield,
    Target,
    Users,
    Clock,
    MessageSquare,
    Plus,
    Box,
    FileCode,
    Activity
} from 'lucide-react';
import { GlassPanel, IronButton, RetroStrata, DesignSystem } from '@/components/ui/DesignSystem';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { getBounty, Bounty } from '@/lib/bounties';
import { useState, useEffect } from 'react';

export default function BountyDetail() {
    const params = useParams();
    const rawId = params?.id;
    const bountyId = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const [bounty, setBounty] = useState<Bounty | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!bountyId) return;
        const fetchBounty = async () => {
            try {
                const data = await getBounty(bountyId);
                setBounty(data);
            } catch (error) {
                console.error("Error fetching bounty:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchBounty();
    }, [bountyId]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0B1120] text-blue-500">
                <Activity className="animate-spin w-8 h-8" />
            </div>
        );
    }

    if (!bounty) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B1120] text-gray-400 p-8 text-center">
                <Target className="w-16 h-16 mb-4 opacity-20" />
                <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white mb-2">Signal Lost</h1>
                <p className="italic mb-8 uppercase text-[10px] tracking-widest text-gray-500">The requested bounty node does not exist or has been decommissioned.</p>
                <Link href="/marketplace/bounty">
                    <IronButton variant="secondary">Return to Registry</IronButton>
                </Link>
            </div>
        );
    }

    const BOUNTY_DATA = {
        title: bounty.title,
        id: `B-${bounty.id.slice(-4).toUpperCase()}`,
        reward: `${bounty.reward.toLocaleString()} Credits`,
        severity: bounty.severity,
        status: bounty.status,
        desc: bounty.description,
        requirements: [
            "Observe the described logic failure in the target module.",
            "Implement a robust fix that passes the network security suite.",
            "Ensure performance parameters remain within protocol limits.",
            "Document the patch and testing methodology."
        ],
        issuer: "DiscoverMake Ops",
        created: "Live Signal",
        participants: 0
    };

    return (
        <div className="flex-1 p-8 bg-[#0B1120] min-h-screen text-[#e8e8f0]">
            {/* Background Aura */}
            <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />

            <div className="max-w-5xl mx-auto relative z-10">
                <Link href="/marketplace/bounty" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-[10px] font-black uppercase tracking-[0.2em] italic mb-8 group">
                    <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                    Back to Registry
                </Link>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-8">
                        <header>
                            <div className="flex items-center gap-3 mb-4">
                                <RetroStrata label={BOUNTY_DATA.id} variant="info" />
                                <RetroStrata label={BOUNTY_DATA.severity} variant="warning" />
                            </div>
                            <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white mb-6 leading-tight">
                                {BOUNTY_DATA.title}
                            </h1>
                            <div className="flex items-center gap-6 text-[10px] font-black text-gray-500 uppercase italic tracking-widest">
                                <span className="flex items-center gap-2"><Clock size={14} className="text-blue-500" /> {BOUNTY_DATA.created}</span>
                                <span className="flex items-center gap-2"><Target size={14} className="text-blue-500" /> {BOUNTY_DATA.issuer}</span>
                                <span className="flex items-center gap-2"><Users size={14} className="text-blue-500" /> {BOUNTY_DATA.participants} Analysis Pings</span>
                            </div>
                        </header>

                        <GlassPanel variant="elevated" className="p-8 rounded-[2.5rem]">
                            <h3 className="text-xl font-black uppercase italic tracking-tighter text-white mb-6">Sovereign Specification</h3>
                            <p className="text-sm text-gray-400 italic leading-relaxed mb-10">
                                {BOUNTY_DATA.desc}
                            </p>

                            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500 mb-6 italic">Resolution Requirements</h4>
                            <div className="space-y-4 mb-10">
                                {BOUNTY_DATA.requirements.map((req, i) => (
                                    <div key={i} className="flex gap-4 group">
                                        <div className="size-6 bg-blue-500/10 rounded-lg flex items-center justify-center shrink-0 border border-blue-500/20 group-hover:bg-blue-500/20 transition-all">
                                            <span className="text-[10px] font-black text-blue-400 italic">{i + 1}</span>
                                        </div>
                                        <p className="text-sm italic text-gray-400 group-hover:text-white transition-colors">{req}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="p-8 rounded-3xl bg-blue-500/10 border border-blue-500/20 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <FileCode className="size-20 text-blue-500" />
                                </div>
                                <h4 className="text-sm font-black text-white italic uppercase tracking-tight mb-4">Submit Proof of Fix</h4>
                                <p className="text-xs text-gray-400 italic leading-relaxed mb-6">
                                    Provide a repository link or sovereign code snippet. Our automated test fleet will verify the fix within 300ms of submission.
                                </p>
                                <div className="flex gap-4">
                                    <input
                                        type="text"
                                        placeholder="GitHub Repo / Code Hash..."
                                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 text-sm italic focus:border-blue-500/50 outline-none"
                                    />
                                    <IronButton variant="primary" size="md" className="rounded-xl">
                                        Submit Fix
                                    </IronButton>
                                </div>
                            </div>
                        </GlassPanel>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-blue-500/20 bg-gradient-to-br from-blue-600/5 to-transparent text-center">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500 mb-4 italic">Bounty Reward</h3>
                            <p className="text-5xl font-black text-white italic tracking-tighter mb-4">{BOUNTY_DATA.reward}</p>
                            <Link href="/marketplace/bounty/escrow">
                                <IronButton variant="primary" className="w-full h-14 rounded-2xl" icon={<Shield size={18} />}>
                                    Claim Bounty
                                </IronButton>
                            </Link>
                        </GlassPanel>

                        <GlassPanel variant="subtle" className="p-8 rounded-[2.5rem]">
                            <h4 className="text-sm font-black text-white italic uppercase tracking-tight mb-6">System Health</h4>
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Activity size={16} className="text-emerald-500" />
                                        <span className="text-xs italic text-gray-400">Network Stability</span>
                                    </div>
                                    <span className="text-[10px] font-black text-emerald-500 italic uppercase">94.2%</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Zap size={16} className="text-blue-500" />
                                        <span className="text-xs italic text-gray-400">Analysis Speed</span>
                                    </div>
                                    <span className="text-[10px] font-black text-blue-500 italic uppercase">21ms</span>
                                </div>
                            </div>
                        </GlassPanel>

                        <div className="p-8 rounded-[2.5rem] bg-white/2 border border-white/5">
                            <h4 className="text-[10px] font-black text-gray-600 tracking-[0.3em] uppercase italic mb-4">Registry Metadata</h4>
                            <p className="text-[10px] text-gray-700 italic font-mono leading-loose">
                                PROTOCOL: Genesis-V2<br />
                                VAULT_ID: SX-9981<br />
                                ENCRYPTION: Sovereignty-Level IV
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
