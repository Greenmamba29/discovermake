"use client";

import React, { useState, useEffect } from 'react';
import {
    Shield,
    Lock,
    CreditCard,
    ChevronLeft,
    Zap,
    CheckCircle2,
    Activity,
    AlertCircle
} from 'lucide-react';
import { GlassPanel, IronButton, RetroStrata, DesignSystem } from '@/components/ui/DesignSystem';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useSearchParams } from 'next/navigation';
import { getBounty, updateBountyStatus, subscribeToBounty, Bounty } from '@/lib/bounties';
import { toast } from 'sonner';
import { Suspense } from 'react';

function EscrowContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const bountyId = searchParams.get('id');
    const [bounty, setBounty] = useState<Bounty | null>(null);
    const [status, setStatus] = useState<'idle' | 'authorizing' | 'success'>('idle');
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

    const handleAuthorize = async () => {
        if (!bountyId) return;

        setStatus('authorizing');
        try {
            await updateBountyStatus(bountyId, 'escrow_locked');
            setTimeout(async () => {
                await updateBountyStatus(bountyId, 'open');
                setStatus('success');
                toast.success("Vault Lock Successful");
                setTimeout(() => {
                    router.push(`/marketplace/bounty/status?id=${bountyId}`);
                }, 2000);
            }, 3000);
        } catch (error) {
            console.error("Escrow authorization failed:", error);
            setStatus('idle');
            toast.error("Vault Connection Error");
        }
    };

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
                <AlertCircle className="text-red-500 size-12 mx-auto mb-4" />
                <h2 className="text-2xl font-black italic text-white uppercase">Protocol Not Found</h2>
                <Link href="/marketplace/bounty" className="text-blue-400 hover:underline mt-4 inline-block italic">Return to Registry</Link>
            </div>
        );
    }

    const rewardAmount = bounty?.reward || 0;
    const executionFee = Math.round(rewardAmount * 0.04);
    const protectionFee = Math.round(rewardAmount * 0.01);
    const totalRequirement = rewardAmount + executionFee + protectionFee;

    return (
        <div className="flex-1 p-8 bg-[#0B1120] min-h-screen text-[#e8e8f0]">
            <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />
            <div className="max-w-3xl mx-auto relative z-10">
                <Link href="/marketplace/bounty/create" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-[10px] font-black uppercase tracking-[0.2em] italic mb-8 group">
                    <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                    Back to Spec
                </Link>
                <header className="mb-12">
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500 mb-2 italic">Financial Protocol</h2>
                    <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white">Registry Escrow</h1>
                </header>
                <div className="space-y-8">
                    <GlassPanel variant="elevated" className="p-10 rounded-[2.5rem] border-blue-500/20 bg-gradient-to-br from-blue-600/5 to-transparent">
                        <div className="flex justify-between items-start mb-10">
                            <div>
                                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500 mb-2 italic">Bounty Total</h3>
                                <p className="text-6xl font-black text-white italic tracking-tighter">{rewardAmount.toLocaleString()} <span className="text-2xl text-blue-400">Credits</span></p>
                            </div>
                            <div className="size-16 bg-blue-500/20 rounded-[1.25rem] flex items-center justify-center border border-blue-500/30">
                                <Shield className="text-blue-400 size-8" />
                            </div>
                        </div>
                        <div className="space-y-4 mb-10">
                            <div className="flex justify-between items-center py-4 border-b border-white/5">
                                <span className="text-sm italic text-gray-400">System Execution Fee</span>
                                <span className="text-sm font-black text-white italic tracking-tighter">{executionFee.toLocaleString()} Credits</span>
                            </div>
                            <div className="flex justify-between items-center py-4 border-b border-white/5">
                                <span className="text-sm italic text-gray-400">Network Protection Fee</span>
                                <span className="text-sm font-black text-white italic tracking-tighter">{protectionFee.toLocaleString()} Credits</span>
                            </div>
                            <div className="flex justify-between items-center py-4">
                                <span className="text-sm italic text-blue-400">Total Escrow Requirement</span>
                                <span className="text-sm font-black text-white italic tracking-tighter">{totalRequirement.toLocaleString()} Credits</span>
                            </div>
                        </div>
                        <div className="p-6 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center gap-4">
                            <Lock className="text-blue-400 size-6 shrink-0" />
                            <p className="text-xs text-gray-400 italic font-medium leading-relaxed">
                                Assets will be locked in the <span className="text-white">DiscoverMake Sovereign Vault</span> and released only upon verified proof of resolution.
                            </p>
                        </div>
                    </GlassPanel>
                    <div className="space-y-6">
                        {status === 'idle' && (
                            <IronButton
                                onClick={handleAuthorize}
                                variant="primary"
                                size="lg"
                                className="w-full h-20 rounded-[1.5rem] text-xl font-black uppercase tracking-[0.2em] italic"
                                icon={<CreditCard size={24} />}
                            >
                                Authorize Vault Deposit
                            </IronButton>
                        )}
                        {status === 'authorizing' && (
                            <GlassPanel variant="glow" className="h-20 flex items-center justify-center gap-4 rounded-[1.5rem] border-blue-500/50">
                                <Activity className="text-blue-400 animate-pulse" />
                                <span className="text-lg font-black uppercase italic tracking-widest text-blue-400 animate-pulse">Syncing with Vault...</span>
                            </GlassPanel>
                        )}
                        {status === 'success' && (
                            <div className="h-20 bg-emerald-500/20 border border-emerald-500/50 rounded-[1.5rem] flex items-center justify-center gap-4">
                                <CheckCircle2 className="text-emerald-400" />
                                <span className="text-lg font-black uppercase italic tracking-widest text-emerald-400">Escrow Genesis Complete</span>
                            </div>
                        )}
                        <div className="flex items-center justify-center gap-2">
                            <AlertCircle className="text-gray-700 size-3" />
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-700 italic">
                                SECURE TRANSACTION • DISCOVERMAKE GENESIS PROTOCOL 2026
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function BountyEscrow() {
    return (
        <Suspense fallback={
            <div className="flex-1 p-8 bg-[#0B1120] min-h-screen flex items-center justify-center">
                <Activity className="text-blue-500 animate-spin size-10" />
            </div>
        }>
            <EscrowContent />
        </Suspense>
    );
}

