import { motion, AnimatePresence } from "framer-motion";
import { Clock, Zap } from "lucide-react";
import { useState, useEffect } from "react";

interface TimeSavedToastProps {
    hoursSaved: number;
    isOpen: boolean;
    onClose: () => void;
}

export function TimeSavedToast({ hoursSaved, isOpen, onClose }: TimeSavedToastProps) {
    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(onClose, 5000);
            return () => clearTimeout(timer);
        }
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 50, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="fixed bottom-8 right-8 z-50 max-w-sm"
                >
                    <div className="bg-slate-900 border border-blue-500/30 p-4 rounded-xl shadow-2xl shadow-blue-500/20 backdrop-blur-md relative overflow-hidden">
                        {/* Shimmer effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />

                        <div className="flex items-start gap-4 relative z-10">
                            <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full text-white shadow-lg">
                                <Clock className="w-6 h-6 animate-pulse" />
                            </div>
                            <div>
                                <h4 className="font-bold text-white text-lg leading-tight mb-1">
                                    You reclaimed <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">{hoursSaved} hours!</span>
                                </h4>
                                <p className="text-slate-400 text-sm leading-relaxed">
                                    That&apos;s time for family, hobbies, or building your next big thing. Go satisfy your soul!
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="text-slate-500 hover:text-white transition-colors"
                            >
                                <Zap className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
