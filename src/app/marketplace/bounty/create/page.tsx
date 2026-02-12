"use client";

import React, { useState } from 'react';
import {
    Target,
    Shield,
    ChevronLeft,
    Plus,
    AlertTriangle,
    FileText,
    DollarSign,
    Lock
} from 'lucide-react';
import { GlassPanel, IronButton, DesignSystem } from '@/components/ui/DesignSystem';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { createBounty, Bounty } from '@/lib/bounties';
import { useAuth } from '@/components/auth-provider';
import { toast } from 'sonner';

export default function CreateBounty() {
    const router = useRouter();
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [severity, setSeverity] = useState<Bounty['severity']>('Medium');
    const [reward, setReward] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !title || !description || !reward) return;

        setIsSubmitting(true);
        try {
            const bountyId = await createBounty(user.uid, {
                title,
                description,
                severity,
                reward: parseFloat(reward)
            });

            if (bountyId) {
                toast.success("Bounty Signal Initiated");
                router.push(`/marketplace/bounty/escrow?id=${bountyId}`);
            }
        } catch (error) {
            console.error("Error creating bounty:", error);
            toast.error("Signal Interference", {
                description: "Failed to broadcast bounty to the network."
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex-1 p-8 bg-[#0B1120] min-h-screen text-[#e8e8f0]">
            {/* Background Aura */}
            <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />

            <div className="max-w-4xl mx-auto relative z-10">
                <Link href="/marketplace/bounty" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-[10px] font-black uppercase tracking-[0.2em] italic mb-8 group">
                    <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                    Back to Registry
                </Link>

                <header className="mb-12">
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500 mb-2 italic">Signal Protocol</h2>
                    <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white">Initialize Bounty</h1>
                </header>

                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Form Section */}
                    <div className="md:col-span-2 space-y-6">
                        <GlassPanel variant="elevated" className="p-8 rounded-[2.5rem]">
                            <div className="space-y-8">
                                <div>
                                    <label className="block text-[10px] font-black text-gray-500 tracking-widest uppercase italic mb-4">Protocol Issue Title</label>
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="e.g. AuthNode V2 Latency Spike"
                                        required
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white italic focus:border-blue-500/50 outline-none transition-all placeholder:text-gray-700 h-16 text-lg"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] font-black text-gray-500 tracking-widest uppercase italic mb-4">Spec Description</label>
                                    <textarea
                                        rows={6}
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        placeholder="Describe the sovereign logic failure and expected resolution..."
                                        required
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white italic focus:border-blue-500/50 outline-none transition-all placeholder:text-gray-700 resize-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-500 tracking-widest uppercase italic mb-4">Severity</label>
                                        <select
                                            value={severity}
                                            onChange={(e) => setSeverity(e.target.value as Bounty['severity'])}
                                            className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white italic focus:border-blue-500/50 outline-none appearance-none cursor-pointer"
                                        >
                                            <option className="bg-[#0B1120]" value="Low">Low</option>
                                            <option className="bg-[#0B1120]" value="Medium">Medium</option>
                                            <option className="bg-[#0B1120]" value="High">High</option>
                                            <option className="bg-[#0B1120]" value="Critical">Critical</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-500 tracking-widest uppercase italic mb-4">Reward Budget</label>
                                        <div className="relative">
                                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 size-4" />
                                            <input
                                                type="number"
                                                value={reward}
                                                onChange={(e) => setReward(e.target.value)}
                                                placeholder="0.00"
                                                required
                                                className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pl-12 text-white italic focus:border-blue-500/50 outline-none transition-all placeholder:text-gray-700"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </GlassPanel>

                        <div className="flex gap-4">
                            <IronButton
                                type="submit"
                                disabled={isSubmitting || !title || !description || !reward}
                                variant="primary"
                                size="lg"
                                className="w-full h-16 rounded-2xl text-lg uppercase italic font-black tracking-widest"
                                icon={isSubmitting ? <Target className="animate-pulse" /> : <Plus />}
                            >
                                {isSubmitting ? "Broadcasting..." : "Advance to Escrow"}
                            </IronButton>
                        </div>
                    </div>

                    {/* Meta Section */}
                    <div className="space-y-6">
                        <GlassPanel variant="subtle" className="p-8 rounded-[2.5rem] border-white/5">
                            <h4 className="text-[10px] font-black text-blue-500 tracking-[0.3em] uppercase italic mb-6">Security Protocol</h4>
                            <div className="space-y-6">
                                <div className="flex gap-4">
                                    <div className="size-10 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0">
                                        <Lock className="text-blue-400 size-5" />
                                    </div>
                                    <p className="text-xs text-gray-500 italic leading-relaxed">
                                        Credits are held in a sovereign escrow until the fix is verified by the network overseers.
                                    </p>
                                </div>
                                <div className="flex gap-4">
                                    <div className="size-10 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0">
                                        <Shield className="text-blue-400 size-5" />
                                    </div>
                                    <p className="text-xs text-gray-500 italic leading-relaxed">
                                        Bounty initiators must hold a valid Tier 1 identity expansion.
                                    </p>
                                </div>
                            </div>
                        </GlassPanel>

                        <div className="p-8 rounded-[2.5rem] bg-gradient-to-br from-blue-600/10 to-transparent border border-blue-500/20">
                            <AlertTriangle className="text-amber-500 size-8 mb-4" />
                            <h4 className="text-sm font-black text-white italic uppercase tracking-tight mb-2">Notice</h4>
                            <p className="text-xs text-gray-400 italic">
                                Initializing a false signal will result in a reputation penalty and credit clawback.
                            </p>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
