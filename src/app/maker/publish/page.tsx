"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ChevronRight,
    ChevronLeft,
    Check,
    Zap,
    Layout,
    Code2,
    DollarSign,
    Upload,
    Rocket,
    Globe,
    Shield,
    ArrowLeft,
    Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel, IronButton, RetroStrata } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";
import Link from "next/link";

/**
 * US-015: Maker Hub — Workflow Publishing Wizard
 * 3-Step High-Fidelity Process
 */

const STEPS = [
    { id: 1, title: "Blueprint Identity", icon: Layout },
    { id: 2, title: "Infrastructure", icon: Code2 },
    { id: 3, title: "Foundry Release", icon: Zap }
];

import { useAuth } from "@/components/auth-provider";
import { createWorkflow } from "@/lib/workflows";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function PublishWorkflowPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form State
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("AI Automation");
    const [price, setPrice] = useState("$49");

    const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, 3));
    const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

    const handleSubmit = async () => {
        if (!user || !name || !description) return;

        setIsSubmitting(true);
        try {
            const workflowId = await createWorkflow(user.uid, {
                name,
                description,
                category,
                price
            });

            if (workflowId) {
                toast.success("Genesis Protocol Launched");
                router.push("/dashboard/maker");
            }
        } catch (error) {
            toast.error("Launch Sequence Interrupted");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
            {/* Background */}
            <div className="fixed inset-0 opacity-10 pointer-events-none origin-center scale-125">
                <HeroMotionBackground />
            </div>

            {/* Header */}
            <header className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-xl border-b border-white/5 py-6">
                <div className="max-w-4xl mx-auto px-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard/maker">
                            <button className="size-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all">
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        </Link>
                        <div>
                            <h1 className="text-xl font-black tracking-tight uppercase italic text-white">Publish Workflow</h1>
                            <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic">New Protocol Genesis</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {STEPS.map(s => (
                            <div
                                key={s.id}
                                className={cn(
                                    "size-8 rounded-lg flex items-center justify-center border transition-all duration-500",
                                    currentStep >= s.id ? "bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/20" : "bg-white/5 border-white/10 text-gray-600"
                                )}
                            >
                                <s.icon className="size-4" />
                            </div>
                        ))}
                    </div>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-6 py-12 pb-40 relative z-10">
                <AnimatePresence mode="wait">
                    {currentStep === 1 && (
                        <motion.div
                            key="step1"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="space-y-8"
                        >
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black tracking-tight uppercase italic text-white flex items-center gap-3">
                                    <Layout className="w-8 h-8 text-blue-500" />
                                    Genesis Identity
                                </h2>
                                <p className="text-gray-500 text-sm font-medium italic">Define the core metadata for your automated engine.</p>
                            </div>

                            <GlassPanel variant="glow" className="p-8 rounded-[2rem] border-white/10 space-y-6">
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black tracking-[0.2em] uppercase text-gray-500 italic ml-1">Workflow Name</label>
                                        <input
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="e.g. Advanced LinkedIn Scraper v4"
                                            className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-sm font-bold text-white placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500/50 italic transition-all"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black tracking-[0.2em] uppercase text-gray-500 italic ml-1">Category</label>
                                        <select
                                            value={category}
                                            onChange={(e) => setCategory(e.target.value)}
                                            className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 italic transition-all appearance-none cursor-pointer"
                                        >
                                            <option>AI Automation</option>
                                            <option>SaaS Boilerplate</option>
                                            <option>Data Intelligence</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black tracking-[0.2em] uppercase text-gray-500 italic ml-1">Description</label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            placeholder="The high-level utility of this blueprint..."
                                            rows={4}
                                            className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-sm font-bold text-white placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500/50 italic transition-all resize-none"
                                        />
                                    </div>
                                </div>
                            </GlassPanel>
                        </motion.div>
                    )}

                    {currentStep === 2 && (
                        <motion.div
                            key="step2"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="space-y-8"
                        >
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black tracking-tight uppercase italic text-white flex items-center gap-3">
                                    <Code2 className="w-8 h-8 text-blue-500" />
                                    Infrastructure
                                </h2>
                                <p className="text-gray-500 text-sm font-medium italic">Upload your logic blueprints and define the stack.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="p-8 rounded-[2rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center gap-4 group hover:border-blue-500/30 transition-all cursor-pointer">
                                    <div className="size-16 rounded-3xl bg-blue-600/10 flex items-center justify-center group-hover:bg-blue-600/20 transition-all">
                                        <Upload className="size-8 text-blue-400" />
                                    </div>
                                    <div>
                                        <p className="text-white font-bold uppercase italic text-sm tracking-tight">Upload JSON</p>
                                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mt-1">Logic Pattern File</p>
                                    </div>
                                </div>
                                <div className="p-8 rounded-[2rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center gap-4 group hover:border-purple-500/30 transition-all cursor-pointer">
                                    <div className="size-16 rounded-3xl bg-purple-600/10 flex items-center justify-center group-hover:bg-purple-600/20 transition-all">
                                        <Globe className="size-8 text-purple-400" />
                                    </div>
                                    <div>
                                        <p className="text-white font-bold uppercase italic text-sm tracking-tight">Public Demo URL</p>
                                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mt-1">Proof of Execution</p>
                                    </div>
                                </div>
                            </div>

                            <GlassPanel className="p-8 rounded-[2rem] border-white/5 space-y-4">
                                <h4 className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic">Required Services</h4>
                                <div className="flex flex-wrap gap-2">
                                    {["Redis", "PostgreSQL", "OpenAI", "Stripe", "Firebase"].map(s => (
                                        <button key={s} className="px-5 py-2 rounded-full border border-white/10 bg-white/5 text-[10px] font-black uppercase italic text-gray-400 hover:text-white hover:border-blue-500/30 transition-all">
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </GlassPanel>
                        </motion.div>
                    )}

                    {currentStep === 3 && (
                        <motion.div
                            key="step3"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="space-y-8"
                        >
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black tracking-tight uppercase italic text-white flex items-center gap-3">
                                    <Zap className="w-8 h-8 text-blue-500" />
                                    Foundry Release
                                </h2>
                                <p className="text-gray-500 text-sm font-medium italic">Finalize pricing and broadcast your protocol.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {[
                                    { tier: "Community", price: "$0", fee: "50%", color: "text-gray-400" },
                                    { tier: "Pro Forge", price: "$49", fee: "15%", color: "text-blue-400", active: true },
                                    { tier: "Enterprise", price: "$299+", fee: "5%", color: "text-purple-400" },
                                    { tier: "Bug Bounty", price: "Flexible", fee: "0%", color: "text-red-400" }
                                ].map((p, i) => (
                                    <GlassPanel
                                        key={i}
                                        variant={price === p.price ? "glow" : "subtle"}
                                        onClick={() => setPrice(p.price)}
                                        className={cn(
                                            "p-6 rounded-3xl border-white/5 transition-all cursor-pointer group",
                                            (price === p.price) ? "border-blue-500/30" : "hover:border-white/20"
                                        )}
                                    >
                                        <div className="flex justify-between items-start mb-4">
                                            <p className={cn("text-[10px] font-black uppercase tracking-widest italic", p.color)}>{p.tier}</p>
                                            {price === p.price && <div className="size-4 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/50"><Check className="w-2.5 h-2.5 text-white" /></div>}
                                        </div>
                                        <p className="text-2xl font-black italic tracking-tighter text-white">{p.price}</p>
                                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mt-1 italic">{p.fee} Network Fee</p>
                                    </GlassPanel>
                                ))}
                            </div>

                            <div className="p-6 rounded-3xl bg-emerald-500/5 border border-emerald-500/10 flex items-center gap-4">
                                <Shield className="size-8 text-emerald-400" />
                                <div>
                                    <p className="text-xs font-black text-white italic">IP Protection Active</p>
                                    <p className="text-[9px] font-black uppercase text-emerald-500 tracking-widest italic mt-0.5">Automated DMCA & License Guard</p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Navigation Buttons */}
                <div className="fixed bottom-12 left-0 right-0 z-50 px-6">
                    <div className="max-w-2xl mx-auto flex gap-4">
                        {currentStep > 1 && (
                            <button
                                onClick={prevStep}
                                className="size-16 rounded-2xl bg-white/5 border border-white/10 text-white flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all"
                            >
                                <ChevronLeft className="size-6" />
                            </button>
                        )}
                        {currentStep < 3 ? (
                            <button
                                onClick={nextStep}
                                className="flex-1 h-16 rounded-2xl bg-blue-600 text-white font-black uppercase italic tracking-widest text-[11px] shadow-lg shadow-blue-500/30 hover:bg-blue-500 transition-all flex items-center justify-center gap-3 active:scale-95"
                            >
                                Continue Protocol
                                <ChevronRight className="size-4" />
                            </button>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="flex-1 h-16 rounded-2xl bg-emerald-600 text-white font-black uppercase italic tracking-widest text-[11px] shadow-lg shadow-emerald-500/30 hover:bg-emerald-500 transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50"
                            >
                                {isSubmitting ? <Loader2 className="animate-spin size-5" /> : <Rocket className="size-5" />}
                                {isSubmitting ? 'Launching...' : 'Launch Genesis'}
                            </button>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
