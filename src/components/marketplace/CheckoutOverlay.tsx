"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    CheckCircle,
    Zap,
    X,
    Lock,
    ArrowRight,
    Rocket,
    CreditCard
} from "lucide-react";
import { GlassPanel, IronButton, RetroStrata, DesignSystem } from "@/components/ui/DesignSystem";

interface CheckoutOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    template: {
        id: string;
        name: string;
        price: number;
        imageUrl?: string;
    };
    onConfirm: (templateId: string, name: string, price: number) => Promise<void>;
}

export function CheckoutOverlay({ isOpen, onClose, template, onConfirm }: CheckoutOverlayProps) {
    const [isProcessing, setIsProcessing] = useState(false);

    const handleGenesis = async () => {
        setIsProcessing(true);
        await onConfirm(template.id, template.name, template.price);
        // Redirection happens in the parent, but we handle state here
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-[#0B1120]/80 backdrop-blur-md"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-lg z-10"
                    >
                        <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-blue-500/20 bg-gradient-to-br from-[#0B1120] to-blue-900/10 relative overflow-hidden">
                            {/* Close Button */}
                            <button
                                onClick={onClose}
                                className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>

                            {/* Header */}
                            <div className="mb-8">
                                <RetroStrata label="Secure Protocol" variant="premium" size="sm" className="mb-4" />
                                <h2 className="text-3xl font-black uppercase italic tracking-tighter text-white">
                                    Initiate Genesis
                                </h2>
                                <p className="text-xs font-black uppercase tracking-widest text-blue-400/60 italic mt-1">
                                    Acquiring Sovereign Logic
                                </p>
                            </div>

                            {/* Order Summary */}
                            <div className="space-y-6 mb-8">
                                <GlassPanel variant="subtle" className="p-6 rounded-2xl border-white/5 bg-white/2 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="size-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                                            <Rocket size={20} className="text-blue-400" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Blueprint</p>
                                            <h4 className="text-sm font-bold text-white capitalize">{template.name}</h4>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xl font-black text-white italic tracking-tighter">${template.price}</p>
                                        <p className="text-[8px] font-black uppercase text-blue-400 tracking-widest">Single License</p>
                                    </div>
                                </GlassPanel>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-gray-500 italic">
                                        <CheckCircle size={14} className="text-emerald-400" />
                                        <span>Encrypted Sync</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-gray-500 italic text-right justify-end">
                                        <Lock size={14} className="text-blue-400" />
                                        <span>Stripe Secured</span>
                                    </div>
                                </div>
                            </div>

                            {/* CTA */}
                            <div className="space-y-4">
                                <IronButton
                                    variant="primary"
                                    className="w-full h-16 uppercase italic font-black text-sm border-blue-400/50 shadow-blue-500/20 flex items-center justify-center gap-3 relative overflow-hidden group"
                                    onClick={handleGenesis}
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? (
                                        <>
                                            <Zap size={18} className="animate-pulse" />
                                            INITIALIZING...
                                        </>
                                    ) : (
                                        <>
                                            AUTHORIZE PAYMENT
                                            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                        </>
                                    )}
                                </IronButton>

                                <p className="text-[9px] text-center text-gray-600 font-bold uppercase tracking-widest italic px-8">
                                    By authorizing, you agree to the Sovereign License Protocol and Node-to-Node Transfer Terms.
                                </p>
                            </div>

                            {/* Decorative Background Aura */}
                            <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-blue-600/10 rounded-full blur-[80px] pointer-events-none" />
                        </GlassPanel>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
