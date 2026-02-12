"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Copy, Twitter, Linkedin, Gift, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button"; // Assuming I can use it, or inline if needed

// --- Simple Share Modal ---
export const ShareModal = ({ isOpen, onClose, url = "https://discovermake.com/t/123" }: { isOpen: boolean; onClose: () => void; url?: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 m-auto max-w-md h-fit bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 z-50 shadow-2xl"
                    >
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white">Share this Blueprint</h3>
                            <button onClick={onClose} className="text-neutral-400 hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <button className="flex-1 bg-[#1DA1F2] hover:bg-[#1a91da] text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                                    <Twitter className="w-5 h-5" /> Twitter
                                </button>
                                <button className="flex-1 bg-[#0A66C2] hover:bg-[#0958a8] text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                                    <Linkedin className="w-5 h-5" /> LinkedIn
                                </button>
                            </div>

                            <div className="relative">
                                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                    <Gift className="w-5 h-5 text-neutral-500" />
                                </div>
                                <input
                                    readOnly
                                    value={url}
                                    className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-10 pr-24 text-neutral-300 focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                                <button
                                    onClick={handleCopy}
                                    className="absolute right-1 top-1 bottom-1 px-4 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium text-white transition-colors"
                                >
                                    {copied ? "Copied!" : "Copy"}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

// --- Referral Card (Gamification) ---
export const ReferralCard = () => {
    return (
        <div className="relative overflow-hidden rounded-2xl p-6 bg-gradient-to-br from-indigo-900/50 to-purple-900/50 border border-white/10 group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 blur-[50px] rounded-full -mr-16 -mt-16 pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
                <div className="p-4 bg-white/10 rounded-full">
                    <Gift className="w-8 h-8 text-yellow-400" />
                </div>
                <div className="flex-1 text-center md:text-left">
                    <h4 className="text-xl font-bold text-white mb-1">Get Pro for Free</h4>
                    <p className="text-neutral-400 text-sm">Invite 3 friends and unlock all Premium Templates for 1 month.</p>
                </div>
                <button className="px-6 py-2 bg-white text-black font-bold rounded-full hover:scale-105 transition-transform">
                    Invite Friends
                </button>
            </div>
        </div>
    );
};
