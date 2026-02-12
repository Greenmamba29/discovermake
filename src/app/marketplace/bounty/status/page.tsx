"use client";

import React from 'react';
import {
    Activity,
    CheckCircle2,
    ChevronLeft,
    Shield,
    Zap,
    Clock,
    Target,
    ArrowUpRight,
    Lock
} from 'lucide-react';
import { GlassPanel, IronButton, RetroStrata, ProgressBar, DesignSystem } from '@/components/ui/DesignSystem';
import Link from 'next/link';

import { useSearchParams, useRouter } from 'next/navigation';
import { getBounty, subscribeToBounty, Bounty } from '@/lib/bounties';
import { useState, useEffect, Suspense } from 'react';
import { toast } from 'sonner';

function StatusContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const bountyId = searchParams.get('id');
    const [bounty, setBounty] = useState<Bounty | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!bountyId) {
            setLoading(false);
            return;
        }

        const unsubscribe = subscribeToBounty(bountyId, (data) => {
            setBounty(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [bountyId]);

    if (loading) {
        return (
            <div className="flex-1 p-8 bg-[#0B1120] min-h-screen flex items-center justify-center">
                <Activity className="text-blue-500 animate-spin size-10" />
            </div>
        );
    }

    if (!bounty && bountyId) {
        return (
            <div className="flex-1 p-8 bg-[#0B1120] min-h-screen text-center">
                <Activity className="text-red-500 size-12 mx-auto mb-4" />
                <h2 className="text-2xl font-black italic text-white uppercase">Signal Lost</h2>
                <Link href="/marketplace/bounty" className="text-blue-400 hover:underline mt-4 inline-block italic">Return to Registry</Link>
            </div>
        );
    }

    return (
        <div className="flex-1 p-8 bg-[#0B1120] min-h-screen text-[#e8e8f0]">
            <div className="fixed bottom-0 right-0 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />
            <div className="max-w-4xl mx-auto relative z-10">
                <Link href="/marketplace/bounty" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-[10px] font-black uppercase tracking-[0.2em] italic mb-8 group">
                    <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                    Registry Matrix
                </Link>
                <header className="mb-12 flex justify-between items-end">
                    <div>
                        <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500 mb-2 italic">Operation Status</h2>
                        <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white leading-none">Bounty Resolution</h1>
                    </div>
                    <RetroStrata label="Live Stream" variant="success" pulse />
                </header>
                <div className="space-y-8">
                    <GlassPanel variant="elevated" className="p-10 rounded-[2.5rem] border-blue-500/20 bg-gradient-to-br from-blue-600/5 to-transparent">
                        <div className="flex items-center gap-6 mb-10">
                            <div className="size-20 bg-blue-600/10 rounded-[1.5rem] flex items-center justify-center border border-blue-500/30">
                                <Activity className="text-blue-400 size-10 animate-pulse" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black uppercase italic tracking-tighter text-white mb-2">
                                    {bounty?.status === 'open' ? 'Bounty Broadcast Live' : 'Analyzing Submission'}
                                </h3>
                                <p className="text-sm text-gray-400 italic">{bounty?.title} — <span className="text-blue-500">B-{bounty?.id.slice(-4).toUpperCase()}</span></p>
                            </div>
                        </div>
                        <div className="space-y-8">
                            <div className="space-y-3">
                                <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] italic">
                                    <span className="text-gray-500">Fleet Verification Progress</span>
                                    <span className="text-blue-400">{bounty?.status === 'open' ? '0%' : '82%'}</span>
                                </div>
                                <ProgressBar value={bounty?.status === 'open' ? 0 : 82} showPercentage={false} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {[
                                    { label: 'Registry Sync', status: 'Success', icon: CheckCircle2, color: 'text-emerald-500' },
                                    { label: 'Vault Allocation', status: 'Success', icon: CheckCircle2, color: 'text-emerald-500' },
                                    { label: 'Maker Handshake', status: bounty?.status === 'open' ? 'Pending' : 'In Progress', icon: Activity, color: bounty?.status === 'open' ? 'text-gray-600' : 'text-blue-400 animate-pulse' },
                                    { label: 'Final Resolution', status: 'Pending', icon: Clock, color: 'text-gray-600' }
                                ].map((step, i) => (
                                    <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-white/2 border border-white/5">
                                        <step.icon size={18} className={step.color} />
                                        <div className="flex-1">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic mb-1">{step.label}</div>
                                            <div className="text-sm font-black italic text-white uppercase tracking-tight">{step.status}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </GlassPanel>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <GlassPanel variant="default" className="p-8 rounded-[2.5rem]">
                            <h4 className="text-sm font-black text-white italic uppercase tracking-tight mb-6">Vault Activity</h4>
                            <div className="space-y-6">
                                {[
                                    { time: 'T-Minus', text: 'Bounty Genesis Initialized', icon: Zap },
                                    { time: 'T-Minus', text: `${bounty?.reward.toLocaleString()} Credits Escrowed`, icon: Lock },
                                    { time: 'T-Minus', text: 'Sovereign Network Alert Sent', icon: ArrowUpRight },
                                    { time: 'Awaiting', text: 'Solution Hash Received', icon: Activity }
                                ].map((log, i) => (
                                    <div key={i} className="flex gap-4 group">
                                        <span className="text-[10px] font-black text-gray-600 italic mt-1">{log.time}</span>
                                        <div className="size-2 bg-blue-500/20 rounded-full mt-2 group-hover:bg-blue-500/50 transition-all shrink-0" />
                                        <p className="text-xs italic text-gray-500 group-hover:text-gray-300 transition-colors tracking-tight">{log.text}</p>
                                    </div>
                                ))}
                            </div>
                        </GlassPanel>
                        <div className="space-y-6">
                            <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-blue-500/20 bg-gradient-to-br from-blue-600/5 to-transparent">
                                <Shield className="text-blue-500 size-10 mb-6" />
                                <h4 className="text-sm font-black text-white italic uppercase tracking-tight mb-2">Resolution Protocol</h4>
                                <p className="text-xs text-gray-400 italic leading-relaxed">
                                    The bounty is now live in the Registry Matrix. Makers can begin fabrication immediately. Escrow will remain locked until verified resolution.
                                </p>
                            </GlassPanel>
                            <IronButton
                                onClick={() => router.push('/marketplace/bounty')}
                                variant="secondary"
                                size="lg"
                                className="w-full h-14 rounded-2xl"
                                icon={<ChevronLeft size={18} />}
                            >
                                Return To Marketplace
                            </IronButton>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function BountyStatus() {
    return (
        <Suspense fallback={
            <div className="flex-1 p-8 bg-[#0B1120] min-h-screen flex items-center justify-center">
                <Activity className="text-blue-500 animate-spin size-10" />
            </div>
        }>
            <StatusContent />
        </Suspense>
    );
}

