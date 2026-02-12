"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
    Gift,
    Copy,
    CheckCircle2,
    Users,
    DollarSign,
    TrendingUp,
    Share2,
    Link as LinkIcon,
    ArrowRight,
    Sparkles,
    Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * US-011: Referral Growth Engine
 * 
 * Dual referral system:
 * - Seeker refers another Seeker → $50 reward each
 * - Maker refers another Maker → $100 reward each
 * - Unique referral links with tracking
 * - Referral dashboard in user profile
 */

interface Referral {
    id: string;
    name: string;
    type: "seeker" | "maker";
    status: "pending" | "signed-up" | "completed-project" | "rewarded";
    reward: number;
    date: string;
}

const MOCK_REFERRALS: Referral[] = [
    { id: "r1", name: "Jordan K.", type: "seeker", status: "rewarded", reward: 50, date: "Jan 28" },
    { id: "r2", name: "Sam P.", type: "maker", status: "completed-project", reward: 100, date: "Feb 3" },
    { id: "r3", name: "Alex W.", type: "seeker", status: "signed-up", reward: 50, date: "Feb 7" },
    { id: "r4", name: "Drew L.", type: "maker", status: "pending", reward: 100, date: "Feb 9" },
];

const STATUS_MAP = {
    pending: { label: "Invited", color: "text-white/30", bg: "bg-white/5" },
    "signed-up": { label: "Signed Up", color: "text-blue-400", bg: "bg-blue-500/10" },
    "completed-project": { label: "First Project", color: "text-amber-400", bg: "bg-amber-500/10" },
    rewarded: { label: "Rewarded!", color: "text-emerald-400", bg: "bg-emerald-500/10" },
};

export default function ReferralPage() {
    const [copied, setCopied] = useState(false);
    const referralCode = "DISCO-A7X9K2";
    const referralLink = `https://discovermake.com/join?ref=${referralCode}`;

    const totalEarned = MOCK_REFERRALS.filter((r) => r.status === "rewarded").reduce((s, r) => s + r.reward, 0);
    const totalPending = MOCK_REFERRALS.filter((r) => r.status !== "rewarded" && r.status !== "pending").reduce((s, r) => s + r.reward, 0);

    const handleCopy = () => {
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-white">
            <div className="fixed top-1/4 left-0 w-[500px] h-[500px] bg-amber-600/3 rounded-full blur-[200px] pointer-events-none" />
            <div className="fixed bottom-0 right-0 w-[300px] h-[300px] bg-purple-600/3 rounded-full blur-[120px] pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-40 glass-panel border-b border-white/5">
                <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                            <Gift className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="font-black text-lg tracking-tight">Referral Program</p>
                            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest italic">Earn by sharing</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-8">
                {/* Hero */}
                <div className="glass-card rounded-3xl p-8 text-center mb-8 border-amber-500/10">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                    >
                        <Sparkles className="w-12 h-12 text-amber-400 mx-auto mb-4" />
                        <h1 className="text-3xl font-black tracking-tight mb-2">
                            Invite Friends. Earn Rewards.
                        </h1>
                        <p className="text-sm text-white/40 mb-6 max-w-md mx-auto">
                            Earn <span className="text-amber-400 font-bold">$50</span> for every Seeker and{" "}
                            <span className="text-amber-400 font-bold">$100</span> for every Maker you refer.
                            They earn the same reward!
                        </p>

                        {/* Reward tiers */}
                        <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-6">
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                                <Users className="w-5 h-5 text-blue-400 mx-auto mb-2" />
                                <p className="text-lg font-black text-blue-400">$50</p>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Per Seeker</p>
                            </div>
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-4">
                                <Star className="w-5 h-5 text-purple-400 mx-auto mb-2" />
                                <p className="text-lg font-black text-purple-400">$100</p>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Per Maker</p>
                            </div>
                        </div>

                        {/* Referral link */}
                        <div className="flex items-center gap-2 max-w-md mx-auto">
                            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/60 font-mono text-left truncate">
                                {referralLink}
                            </div>
                            <Button
                                onClick={handleCopy}
                                className={cn(
                                    "h-12 px-6 rounded-xl font-bold text-sm transition-all",
                                    copied
                                        ? "bg-emerald-500 text-white"
                                        : "bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-400 hover:to-orange-500"
                                )}
                            >
                                {copied ? (
                                    <><CheckCircle2 className="w-4 h-4 mr-1" /> Copied!</>
                                ) : (
                                    <><Copy className="w-4 h-4 mr-1" /> Copy</>
                                )}
                            </Button>
                        </div>

                        {/* Share buttons */}
                        <div className="flex items-center justify-center gap-3 mt-4">
                            {["X", "LinkedIn", "WhatsApp"].map((platform) => (
                                <button
                                    key={platform}
                                    className="text-[10px] font-bold text-white/30 hover:text-white/60 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl transition-all italic"
                                >
                                    Share on {platform}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="glass-card rounded-2xl p-4 text-center">
                        <DollarSign className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
                        <p className="text-2xl font-black">${totalEarned}</p>
                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Earned</p>
                    </div>
                    <div className="glass-card rounded-2xl p-4 text-center">
                        <TrendingUp className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                        <p className="text-2xl font-black">${totalPending}</p>
                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Pending</p>
                    </div>
                    <div className="glass-card rounded-2xl p-4 text-center">
                        <Users className="w-5 h-5 text-blue-400 mx-auto mb-2" />
                        <p className="text-2xl font-black">{MOCK_REFERRALS.length}</p>
                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Invites</p>
                    </div>
                </div>

                {/* Referral List */}
                <h3 className="text-sm font-black text-white/50 uppercase tracking-widest mb-4 italic">Your Referrals</h3>
                <div className="space-y-2">
                    {MOCK_REFERRALS.map((referral, i) => {
                        const status = STATUS_MAP[referral.status];
                        return (
                            <motion.div
                                key={referral.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="glass-card rounded-2xl p-4 flex items-center gap-4"
                            >
                                <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black",
                                    referral.type === "maker" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"
                                )}>
                                    {referral.name.split(" ").map((n) => n[0]).join("")}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold">{referral.name}</h4>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/20 italic">
                                            {referral.type}
                                        </span>
                                        <span className="text-white/10">•</span>
                                        <span className="text-[10px] text-white/30">{referral.date}</span>
                                    </div>
                                </div>
                                <div className="text-right flex items-center gap-3">
                                    <span className={cn(
                                        "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full italic",
                                        status.bg, status.color
                                    )}>
                                        {status.label}
                                    </span>
                                    <span className={cn(
                                        "text-sm font-black",
                                        referral.status === "rewarded" ? "text-emerald-400" : "text-white/20"
                                    )}>
                                        ${referral.reward}
                                    </span>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                {/* How It Works */}
                <div className="mt-8 glass-card rounded-3xl p-6">
                    <h3 className="text-sm font-black text-white/50 uppercase tracking-widest mb-4 italic">How It Works</h3>
                    <div className="grid grid-cols-3 gap-4">
                        {[
                            { step: "1", title: "Share Link", desc: "Send your unique referral link" },
                            { step: "2", title: "They Join", desc: "Friend signs up and starts a project" },
                            { step: "3", title: "Both Earn", desc: "You both get rewarded" },
                        ].map((item) => (
                            <div key={item.step} className="text-center">
                                <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 font-black text-sm mx-auto mb-2">
                                    {item.step}
                                </div>
                                <p className="text-xs font-bold">{item.title}</p>
                                <p className="text-[10px] text-white/30">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
}
