"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Splash brand drop: eight cut-part silhouettes drop in, then resolve into the
 * wordmark and tagline. Pure framer-motion (no path-morph dependencies).
 * Respects prefers-reduced-motion by skipping straight to the wordmark.
 */

const SHAPE_PATHS = [
    "M 50,15 L 85,40 L 75,80 L 25,80 L 15,40 Z",
    "M 50,20 L 80,80 L 20,80 Z",
    "M 20,20 L 80,20 L 80,80 L 20,80 Z",
    "M 50,50 m -30,0 a 30,30 0 1,0 60,0 a 30,30 0 1,0 -60,0",
    "M 50,15 L 80,30 L 80,70 L 50,85 L 20,70 L 20,30 Z",
    "M 50,20 L 80,50 L 50,80 L 20,50 Z",
    "M 50,50 m -25,0 a 25,25 0 1,0 50,0 a 25,25 0 1,0 -50,0",
    "M 50,15 L 85,85 L 15,85 Z",
];

const SIGNAL = "#5fe08a";

export function BrandingDrop() {
    const [phase, setPhase] = useState<"shapes" | "wordmark">("shapes");

    useEffect(() => {
        const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) {
            setPhase("wordmark");
            return;
        }
        const t = setTimeout(() => setPhase("wordmark"), 1600);
        return () => clearTimeout(t);
    }, []);

    return (
        <div className="relative flex h-[600px] w-full items-center justify-center overflow-hidden rounded-3xl bg-[#0c0e0d]">
            <div
                className="absolute inset-0 opacity-[0.06]"
                style={{
                    backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
                    backgroundSize: "40px 40px",
                }}
            />
            <AnimatePresence mode="wait">
                {phase === "shapes" ? (
                    <motion.div key="shapes" className="flex gap-4" exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.3 }}>
                        {SHAPE_PATHS.map((d, i) => (
                            <motion.svg
                                key={i}
                                width="56"
                                height="56"
                                viewBox="0 0 100 100"
                                initial={{ opacity: 0, y: -60 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.08, type: "spring", stiffness: 260, damping: 18 }}
                            >
                                <path d={d} fill="none" stroke={i % 3 === 0 ? SIGNAL : "#9aa0a6"} strokeWidth="4" />
                            </motion.svg>
                        ))}
                    </motion.div>
                ) : (
                    <motion.div
                        key="wordmark"
                        className="flex flex-col items-center gap-3"
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5 }}
                    >
                        <h1 className="text-6xl font-black tracking-tighter text-white">DiscoverMake</h1>
                        <span className="text-xs font-bold uppercase tracking-[0.4em] text-gray-400">Discover. Make. Build.</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
