"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Sparkles,
    Users,
    Clock,
    ArrowLeft,
    Zap,
    CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MakersPulse } from "@/components/makers-pulse";
import { TeamAssembly } from "@/components/team-assembly";
import Link from "next/link";

/**
 * Matching Page — Combines US-005 (Makers in Area), US-006 (Team Assembly)
 * 
 * Flow:
 * 1. User enters project description
 * 2. "Scanning" phase with radar animation
 * 3. For small projects → single maker selection
 * 4. For large projects → multi-maker team assembly
 */

type MatchingStep = "describe" | "scanning" | "team" | "confirmed";

export default function MatchingPage() {
    const [step, setStep] = useState<MatchingStep>("describe");
    const [projectDescription, setProjectDescription] = useState("");
    const [projectBudget, setProjectBudget] = useState(5000);
    const [selectedMakerId, setSelectedMakerId] = useState<string | null>(null);
    const isTeamProject = projectBudget > 5000;

    const handleStart = () => {
        if (!projectDescription.trim()) return;
        setStep("scanning");
    };

    const handleMakerSelect = (makerId: string) => {
        setSelectedMakerId(makerId);
        if (isTeamProject) {
            setStep("team");
        } else {
            setStep("confirmed");
        }
    };

    const handleTeamComplete = () => {
        setStep("confirmed");
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-white">
            {/* Background auras */}
            <div className="fixed top-1/3 -left-20 w-[600px] h-[600px] bg-purple-600/5 rounded-full blur-[180px] pointer-events-none" />
            <div className="fixed bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-40 glass-panel border-b border-white/5">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" className="rounded-xl text-white/40 hover:text-white" asChild>
                            <Link href="/marketplace">
                                <ArrowLeft className="w-5 h-5" />
                            </Link>
                        </Button>
                        <div>
                            <p className="font-black text-lg tracking-tight">Find Your Maker</p>
                            <p className="text-xs text-white/40 font-medium">
                                {step === "describe" && "Describe your project"}
                                {step === "scanning" && "Scanning the network..."}
                                {step === "team" && "Assemble your dream team"}
                                {step === "confirmed" && "Project confirmed!"}
                            </p>
                        </div>
                    </div>

                    {/* Step indicators */}
                    <div className="flex items-center gap-2">
                        {["describe", "scanning", isTeamProject ? "team" : null, "confirmed"].filter(Boolean).map((s, i) => (
                            <div
                                key={s}
                                className={cn(
                                    "w-2 h-2 rounded-full transition-all",
                                    step === s ? "w-6 bg-purple-500" :
                                        ["describe", "scanning", "team", "confirmed"].indexOf(step) > ["describe", "scanning", "team", "confirmed"].indexOf(s as MatchingStep)
                                            ? "bg-emerald-500" : "bg-white/10"
                                )}
                            />
                        ))}
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-12">
                <AnimatePresence mode="wait">
                    {/* Step 1: Describe */}
                    {step === "describe" && (
                        <motion.div
                            key="describe"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="max-w-xl mx-auto"
                        >
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-br from-purple-600 to-blue-600 mb-4 shadow-lg shadow-purple-500/20">
                                    <Sparkles className="w-8 h-8 text-white" />
                                </div>
                                <h1 className="text-3xl font-black tracking-tight mb-2">
                                    What do you want to build?
                                </h1>
                                <p className="text-white/40 text-sm">
                                    Describe your project and we&apos;ll match you with the perfect maker
                                </p>
                            </div>

                            <div className="space-y-4">
                                <textarea
                                    value={projectDescription}
                                    onChange={(e) => setProjectDescription(e.target.value)}
                                    placeholder="e.g. I need a mobile app for my restaurant that handles online ordering, table reservations, and a loyalty program..."
                                    className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 text-white placeholder:text-white/20 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30"
                                />

                                <div className="glass-card rounded-2xl p-4">
                                    <label className="text-xs font-bold text-white/40 uppercase tracking-widest italic mb-3 block">
                                        Estimated Budget
                                    </label>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            min={500}
                                            max={50000}
                                            step={500}
                                            value={projectBudget}
                                            onChange={(e) => setProjectBudget(Number(e.target.value))}
                                            className="flex-1 accent-purple-500"
                                        />
                                        <span className="text-lg font-black text-purple-400 min-w-[80px] text-right">
                                            ${projectBudget.toLocaleString()}
                                        </span>
                                    </div>
                                    {isTeamProject && (
                                        <div className="mt-2 flex items-center gap-2 text-xs text-blue-400 font-bold">
                                            <Users className="w-3.5 h-3.5" />
                                            <span className="italic">Team project — you can assemble a full team</span>
                                        </div>
                                    )}
                                </div>

                                <Button
                                    onClick={handleStart}
                                    disabled={!projectDescription.trim()}
                                    className="w-full h-14 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-black text-lg shadow-lg shadow-purple-500/20 disabled:opacity-30"
                                >
                                    <Zap className="w-5 h-5 mr-2" />
                                    Find Makers
                                </Button>
                            </div>
                        </motion.div>
                    )}

                    {/* Step 2: Scanning (US-005) */}
                    {step === "scanning" && (
                        <motion.div
                            key="scanning"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                        >
                            <MakersPulse
                                onSelect={handleMakerSelect}
                                projectTitle={projectDescription.slice(0, 60) + "..."}
                            />
                        </motion.div>
                    )}

                    {/* Step 3: Team Assembly (US-006) — only for large projects */}
                    {step === "team" && (
                        <motion.div
                            key="team"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                        >
                            <TeamAssembly
                                onComplete={handleTeamComplete}
                                projectBudget={projectBudget}
                            />
                        </motion.div>
                    )}

                    {/* Step 4: Confirmed */}
                    {step === "confirmed" && (
                        <motion.div
                            key="confirmed"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="max-w-md mx-auto text-center py-12"
                        >
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", damping: 10, delay: 0.2 }}
                            >
                                <CheckCircle2 className="w-20 h-20 text-emerald-400 mx-auto mb-6" />
                            </motion.div>
                            <h2 className="text-3xl font-black tracking-tight mb-3">
                                Project Launched! 🚀
                            </h2>
                            <p className="text-white/40 text-sm mb-8">
                                {isTeamProject
                                    ? "Your team has been assembled. Timer starts when all makers accept."
                                    : "Your maker has been notified. Timer starts on acceptance."}
                            </p>
                            <div className="space-y-3">
                                <Button
                                    className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-bold"
                                    asChild
                                >
                                    <Link href="/dashboard/client">
                                        Go to Dashboard
                                    </Link>
                                </Button>
                                <Button
                                    variant="ghost"
                                    className="w-full h-12 rounded-2xl text-white/40 font-bold"
                                    asChild
                                >
                                    <Link href="/marketplace">
                                        Browse More Makers
                                    </Link>
                                </Button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>
        </div>
    );
}
