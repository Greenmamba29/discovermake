"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
    Clock,
    CheckCircle2,
    XCircle,
    DollarSign,
    FileText,
    Calendar,
    AlertTriangle,
    Zap,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * US-007: Maker Acceptance & Timer
 * 
 * When a Maker receives a gig offer:
 * 1. View project brief, timeline, payment
 * 2. Accept → timer starts, added to project chat
 * 3. Decline → triggers re-matching
 * 4. 24-hour auto-decline if no response
 */

export interface GigOffer {
    id: string;
    projectTitle: string;
    description: string;
    budget: { min: number; max: number };
    timeline: string;
    milestones: { title: string; duration: string }[];
    seekerRating: number;
    role: string;
    expiresAt: Date;
    teamSize: number;
}

interface ProjectTimerProps {
    startTime: Date;
    deadline: Date;
    milestones: { title: string; duration: string; completed: boolean }[];
}

/**
 * Countdown timer showing remaining time to accept an offer
 */
function AcceptanceCountdown({ expiresAt }: { expiresAt: Date }) {
    const [timeLeft, setTimeLeft] = useState("");

    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const diff = expiresAt.getTime() - now.getTime();
            if (diff <= 0) {
                setTimeLeft("Expired");
                return;
            }
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
        }, 1000);
        return () => clearInterval(interval);
    }, [expiresAt]);

    const isUrgent = expiresAt.getTime() - Date.now() < 2 * 60 * 60 * 1000; // <2hrs

    return (
        <div className={cn(
            "flex items-center gap-2 text-xs font-bold italic px-3 py-1.5 rounded-full",
            isUrgent
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
        )}>
            <Clock className="w-3.5 h-3.5" />
            {timeLeft === "Expired" ? "Offer Expired" : `${timeLeft} remaining`}
        </div>
    );
}

/**
 * Gig Offer Card — shown to Makers when they receive a new gig
 */
export function GigOfferCard({
    offer,
    onAccept,
    onDecline,
}: {
    offer: GigOffer;
    onAccept: (offerId: string) => void;
    onDecline: (offerId: string) => void;
}) {
    const [showDetails, setShowDetails] = useState(false);
    const [accepting, setAccepting] = useState(false);
    const [declining, setDeclining] = useState(false);
    const [status, setStatus] = useState<"pending" | "accepted" | "declined">("pending");

    const handleAccept = () => {
        setAccepting(true);
        setTimeout(() => {
            setStatus("accepted");
            setAccepting(false);
            onAccept(offer.id);
        }, 1200);
    };

    const handleDecline = () => {
        setDeclining(true);
        setTimeout(() => {
            setStatus("declined");
            setDeclining(false);
            onDecline(offer.id);
        }, 800);
    };

    if (status === "accepted") {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-card rounded-3xl p-8 text-center border-emerald-500/20"
            >
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 10 }}
                >
                    <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                </motion.div>
                <h3 className="text-xl font-black tracking-tight mb-2">Gig Accepted!</h3>
                <p className="text-sm text-white/40 mb-4">Timer has started. You&apos;ve been added to the project chat.</p>
                <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-bold">
                    <Zap className="w-4 h-4" />
                    Project timer is now running
                </div>
            </motion.div>
        );
    }

    if (status === "declined") {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                className="glass-card rounded-3xl p-6 text-center"
            >
                <XCircle className="w-10 h-10 text-white/20 mx-auto mb-2" />
                <p className="text-sm text-white/30 italic">Gig declined. Re-matching in progress...</p>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-3xl overflow-hidden"
        >
            {/* Header */}
            <div className="p-6 pb-0">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-purple-400 italic">
                            New Gig Offer
                        </span>
                        <h3 className="text-xl font-black tracking-tight mt-1">{offer.projectTitle}</h3>
                    </div>
                    <AcceptanceCountdown expiresAt={offer.expiresAt} />
                </div>

                <p className="text-sm text-white/50 leading-relaxed mb-4">{offer.description}</p>

                {/* Quick stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-white/5 rounded-xl p-3 text-center">
                        <DollarSign className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                        <p className="text-sm font-black">${offer.budget.min.toLocaleString()}-${offer.budget.max.toLocaleString()}</p>
                        <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest italic">Budget</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3 text-center">
                        <Calendar className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                        <p className="text-sm font-black">{offer.timeline}</p>
                        <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest italic">Timeline</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3 text-center">
                        <FileText className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                        <p className="text-sm font-black">{offer.role}</p>
                        <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest italic">Your Role</p>
                    </div>
                </div>
            </div>

            {/* Expandable milestones */}
            <div className="px-6">
                <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="w-full flex items-center justify-between py-3 border-t border-white/5 text-xs font-bold text-white/40 hover:text-white/60 transition-colors"
                >
                    <span>View Milestones ({offer.milestones.length})</span>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", showDetails && "rotate-180")} />
                </button>
                {showDetails && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        className="space-y-2 pb-4"
                    >
                        {offer.milestones.map((m, i) => (
                            <div key={i} className="flex items-center gap-3 p-2 bg-white/5 rounded-xl">
                                <span className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-[10px] font-black text-white/40">
                                    {i + 1}
                                </span>
                                <span className="text-xs font-medium flex-1">{m.title}</span>
                                <span className="text-[10px] text-white/30 italic">{m.duration}</span>
                            </div>
                        ))}
                    </motion.div>
                )}
            </div>

            {/* Actions */}
            <div className="p-6 pt-3 flex gap-3">
                <Button
                    onClick={handleDecline}
                    disabled={declining}
                    variant="ghost"
                    className="flex-1 h-12 rounded-2xl border border-white/10 hover:border-red-500/30 hover:bg-red-500/5 font-bold text-white/60 hover:text-red-400"
                >
                    {declining ? "Declining..." : "Decline"}
                </Button>
                <Button
                    onClick={handleAccept}
                    disabled={accepting}
                    className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-black shadow-lg shadow-emerald-500/20"
                >
                    {accepting ? (
                        <span className="flex items-center gap-2">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            >
                                <Clock className="w-4 h-4" />
                            </motion.div>
                            Starting Timer...
                        </span>
                    ) : (
                        "Accept Gig"
                    )}
                </Button>
            </div>

            {/* Team info */}
            {offer.teamSize > 1 && (
                <div className="px-6 pb-4">
                    <p className="text-[10px] text-white/20 text-center italic">
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        Team project: Timer starts when all {offer.teamSize} makers accept
                    </p>
                </div>
            )}
        </motion.div>
    );
}

/**
 * Project Timer — Tracks elapsed time after maker acceptance
 */
export function ProjectTimer({
    startTime,
    deadline,
    milestones,
}: ProjectTimerProps) {
    const [elapsed, setElapsed] = useState("");
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const elapsedMs = now.getTime() - startTime.getTime();
            const totalMs = deadline.getTime() - startTime.getTime();

            setProgress(Math.min(100, (elapsedMs / totalMs) * 100));

            const days = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
            const hours = Math.floor((elapsedMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            setElapsed(`${days}d ${hours}h`);
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime, deadline]);

    const completedCount = milestones.filter((m) => m.completed).length;

    return (
        <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-black uppercase tracking-widest text-white/40 italic">
                    Project Timer
                </span>
                <span className="text-xs font-bold text-white/50">{elapsed} elapsed</span>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-3">
                <motion.div
                    className={cn(
                        "h-full rounded-full",
                        progress > 80 ? "bg-red-500" :
                            progress > 50 ? "bg-amber-500" : "bg-emerald-500"
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                />
            </div>

            {/* Milestones */}
            <div className="flex items-center justify-between text-[10px] font-bold text-white/30">
                <span>{completedCount}/{milestones.length} milestones</span>
                <span className={cn(
                    progress > 80 ? "text-red-400" : "text-white/30"
                )}>
                    {Math.round(progress)}% timeline used
                </span>
            </div>
        </div>
    );
}
