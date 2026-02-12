"use client";

import React, { useRef, useEffect, useState } from "react";
import {
    Sparkles,
    Bot,
    Send,
    StopCircle,
    ArrowLeft,
    MoreHorizontal,
    Smartphone,
    CreditCard,
    Box,
    Mic,
    CheckCircle2,
    History,
    Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { GlassPanel, IronButton, RetroStrata } from "@/components/ui/DesignSystem";
import { cn } from "@/lib/utils";

/**
 * Hi-Fi Seeker Architect Hub: The "Project Builder"
 * Derived from assets/rider_home_map/stitch_rider_home_map/ai_request_builder
 */

export default function ArchitectPage() {
    const { messages, sendMessage, status, stop } = useChat();
    const [input, setInput] = useState("");
    const [specProgress, setSpecProgress] = useState(40);
    const [showHistory, setShowHistory] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const isLoading = status === 'streaming' || status === 'submitted';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const currentInput = input;
        setInput("");
        await sendMessage({ role: 'user', parts: [{ type: 'text', text: currentInput }] });

        // Simulate progress increase
        setSpecProgress(prev => Math.min(prev + 15, 100));
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <div className="min-h-screen bg-[#0B1622] text-white font-sans selection:bg-blue-500/30 overflow-hidden flex flex-col max-w-md mx-auto border-x border-white/5 shadow-2xl relative">

            {/* Ambient Backgrounds */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 pointer-events-none overflow-hidden max-w-md">
                <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
                <div className="absolute bottom-[10%] right-[-10%] w-[50%] h-[30%] bg-purple-600/10 blur-[100px] rounded-full" />
            </div>

            {/* Header */}
            <header className="z-50 flex items-center bg-[#101622]/80 backdrop-blur-xl p-4 pb-3 justify-between border-b border-white/5">
                <Link href="/dashboard">
                    <button className="text-white p-2 hover:bg-white/5 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </Link>
                <div className="flex flex-col items-center">
                    <h2 className="text-white text-base font-black leading-tight tracking-tight uppercase">Project Builder</h2>
                    <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-black italic">Devie Online</span>
                    </div>
                </div>
                <button
                    className="p-2 text-white hover:bg-white/5 rounded-full transition-colors"
                    onClick={() => setShowHistory(true)}
                >
                    <History className="w-5 h-5" />
                </button>
            </header>

            {/* Real-time Spec Floating Card */}
            <div className="absolute top-24 left-4 right-4 z-40">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-blue-600/10 backdrop-blur-2xl border border-blue-500/20 rounded-2xl p-4 shadow-2xl"
                >
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest italic mb-1">Real-time Spec</p>
                            <h3 className="text-white font-bold text-sm tracking-tight">Luxury E-commerce Platform</h3>
                        </div>
                        <RetroStrata
                            label={`${specProgress}% Defined`}
                            variant={specProgress > 80 ? "success" : "info"}
                            pulse={isLoading}
                        />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                        {[
                            { icon: <Smartphone />, label: "iOS App" },
                            { icon: <CreditCard />, label: "Stripe" },
                            { icon: <Box />, label: "Shopify Sync" }
                        ].map((chip, i) => (
                            <div key={i} className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/10 shrink-0">
                                <span className="w-3 h-3 text-blue-400">
                                    {chip.icon}
                                </span>
                                <span className="text-[11px] text-gray-300 font-medium">{chip.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]"
                            animate={{ width: `${specProgress}%` }}
                        />
                    </div>
                </motion.div>
            </div>

            {/* Chat Area */}
            <main className="flex-1 overflow-y-auto px-4 pt-48 pb-36 flex flex-col gap-6 scrollbar-none">
                {messages.length === 0 ? (
                    <div className="flex items-end gap-3 max-w-[85%]">
                        <div className="w-9 h-9 shrink-0 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 shadow-lg shadow-blue-500/20 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <GlassPanel variant="subtle" className="rounded-2xl rounded-bl-none p-4 text-sm leading-relaxed text-gray-200">
                                Hi! I&apos;m Devie. I&apos;m helping you architect your vision. What kind of app are we building today?
                            </GlassPanel>
                            <span className="text-[10px] text-gray-500 ml-1 font-bold uppercase tracking-widest">Devie • Just now</span>
                        </div>
                    </div>
                ) : (
                    messages.map((m: any, i: number) => (
                        <div key={m.id || i} className={cn(
                            "flex items-end gap-3 max-w-[85%]",
                            m.role === 'user' ? "self-end flex-row-reverse" : "self-start"
                        )}>
                            <div className={cn(
                                "w-9 h-9 shrink-0 rounded-2xl flex items-center justify-center transition-all",
                                m.role === 'user'
                                    ? "bg-gray-800 border border-white/10"
                                    : "bg-gradient-to-br from-blue-600 to-blue-400 shadow-lg shadow-blue-500/20"
                            )}>
                                {m.role === 'user' ? <CheckCircle2 className="w-5 h-5 text-blue-400" /> : <Bot className="w-5 h-5 text-white" />}
                            </div>
                            <div className={cn("flex flex-col gap-1.5", m.role === 'user' ? "items-end" : "items-start")}>
                                <div className={cn(
                                    "rounded-2xl p-4 text-sm leading-relaxed transition-all",
                                    m.role === 'user'
                                        ? "bg-blue-600 text-white rounded-br-none shadow-xl shadow-blue-500/10"
                                        : "bg-white/5 backdrop-blur-xl border border-white/10 text-gray-200 rounded-bl-none"
                                )}>
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        <ReactMarkdown>
                                            {m.content}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest px-1">
                                    {m.role === 'assistant' ? 'Devie' : 'You'} • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    ))
                )}

                {isLoading && (
                    <div className="flex items-end gap-3 max-w-[85%] opacity-70">
                        <div className="w-9 h-9 shrink-0 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                        </div>
                        <div className="bg-white/5 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-2xl rounded-bl-none flex gap-1.5 items-center">
                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </main>

            {/* Remix History Slider (Drawer) */}
            <AnimatePresence>
                {showHistory && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowHistory(false)}
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] max-w-md mx-auto"
                        />
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="fixed bottom-0 left-0 right-0 z-[70] bg-[#0B1622] rounded-t-[2.5rem] border-t border-white/10 p-8 pt-6 max-w-md mx-auto h-[70vh]"
                        >
                            <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto mb-8" />
                            <div className="flex items-center justify-between mb-8">
                                <h3 className="text-xl font-black uppercase italic tracking-tight">Remix History</h3>
                                <RetroStrata label="5 Total" variant="info" />
                            </div>

                            <div className="space-y-4 overflow-y-auto h-[cal(100%-80px)] no-scrollbar pb-10">
                                {[
                                    { title: "SaaS Boilerplate v2", date: "2 Hours Ago", status: "Success" },
                                    { title: "AI Content Engine", date: "Yesterday", status: "Active" },
                                    { title: "E-com Analytics Dash", date: "Feb 08", status: "Success" },
                                    { title: "Crypto Ticker v4", date: "Feb 05", status: "Failed" },
                                    { title: "LinkedIn Outreach", date: "Jan 28", status: "Success" }
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center justify-between p-5 rounded-3xl bg-white/5 border border-white/5 hover:border-blue-500/20 transition-all group">
                                        <div className="flex items-center gap-4">
                                            <div className={cn(
                                                "size-10 rounded-2xl flex items-center justify-center",
                                                item.status === "Success" ? "bg-emerald-500/10 text-emerald-400" :
                                                    item.status === "Active" ? "bg-blue-500/10 text-blue-400" : "bg-red-500/10 text-red-400"
                                            )}>
                                                <History className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-sm text-white group-hover:text-blue-400 transition-colors uppercase italic">{item.title}</p>
                                                <p className="text-[10px] font-black uppercase italic text-gray-500 tracking-widest">{item.date}</p>
                                            </div>
                                        </div>
                                        <IronButton variant="secondary" size="sm" className="h-9 px-4 text-[9px] uppercase font-black italic">
                                            One-Tap Remix
                                        </IronButton>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
