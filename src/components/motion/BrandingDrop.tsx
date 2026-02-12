"use client";

import React, { useEffect, useState, useMemo } from "react";
import { motion, useAnimation, AnimatePresence } from "framer-motion";
import { interpolate } from "d3-interpolate";
import { interpolate as flubberInterpolate } from "flubber";
import { Zap } from "lucide-react";

// --- SVG PATHS ---

// 8 Basic Geometric Shapes
const SHAPE_PATHS = [
    "M 50,15 L 85,40 L 75,80 L 25,80 L 15,40 Z", // Pentagon
    "M 50,20 L 80,80 L 20,80 Z",               // Triangle
    "M 20,20 L 80,20 L 80,80 L 20,80 Z",       // Square
    "M 50,50 m -30,0 a 30,30 0 1,0 60,0 a 30,30 0 1,0 -60,0", // Circle
    "M 50,15 L 80,30 L 80,70 L 50,85 L 20,70 L 20,30 Z", // Hexagon
    "M 50,20 L 80,50 L 50,80 L 20,50 Z",       // Diamond
    "M 50,50 m -25,0 a 25,25 0 1,0 50,0 a 25,25 0 1,0 -50,0", // Circle (slightly smaller)
    "M 50,15 L 85,85 L 15,85 Z",               // Triangle (slightly different)
];

// Block Letters for "DISCOVER"
const LETTER_PATHS = [
    "M 20,20 L 60,20 C 75,20 85,35 85,50 C 85,65 75,80 60,80 L 20,80 Z", // D
    "M 35,20 L 65,20 L 65,80 L 35,80 Z",                                // I
    "M 80,35 C 75,25 65,20 50,20 C 35,20 20,35 20,50 C 20,65 35,80 50,80 C 65,80 75,70 80,60", // S
    "M 80,30 C 75,20 60,20 50,20 C 30,20 20,35 20,50 C 20,65 30,80 50,80 C 60,80 75,80 80,70", // C
    "M 50,20 C 30,20 20,35 20,50 C 20,65 30,80 50,80 C 70,80 80,65 80,50 C 80,35 70,20 50,20 Z", // O
    "M 20,20 L 50,80 L 80,20",                                          // V
    "M 20,20 L 80,20 L 80,35 L 35,35 L 35,45 L 70,45 L 70,60 L 35,60 L 35,80 L 80,80", // E
    "M 20,20 L 60,20 C 70,20 80,30 80,40 C 80,50 70,60 60,60 L 80,80 L 65,80 L 45,60 L 35,60 L 35,80 L 20,80 Z", // R
];

const COLORS = [
    "#3b82f6", // Blue
    "#ef4444", // Red
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#6366f1", // Indigo
    "#ec4899", // Pink
    "#8b5cf6", // Violet
    "#06b6d4", // Cyan
];

export function BrandingDrop() {
    const [scene, setScene] = useState(1);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (scene === 1) setScene(2);
            else if (scene === 2) {
                let p = 0;
                const interval = setInterval(() => {
                    p += 0.02;
                    if (p >= 1) {
                        setProgress(1);
                        clearInterval(interval);
                        setTimeout(() => setScene(3), 500);
                    } else {
                        setProgress(p);
                    }
                }, 20);
            } else if (scene === 3) {
                setTimeout(() => setScene(4), 2000);
            }
        }, 1500);

        return () => clearTimeout(timer);
    }, [scene]);

    // Generate interpolators for each shape
    const interpolators = useMemo(() => {
        return SHAPE_PATHS.map((path, i) => flubberInterpolate(path, LETTER_PATHS[i]));
    }, []);

    return (
        <div className="relative w-full h-[600px] flex items-center justify-center bg-white overflow-hidden rounded-3xl border border-gray-100 shadow-2xl">
            {/* Background Grid */}
            <div
                className="absolute inset-0 opacity-[0.05]"
                style={{
                    backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)',
                    backgroundSize: '40px 40px'
                }}
            />

            {/* Scene 1 & 2: Shapes & Morphing */}
            {scene <= 2 && (
                <div className="flex gap-4">
                    {SHAPE_PATHS.map((_, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 50 }}
                            animate={{
                                opacity: 1,
                                y: scene === 2 ? [0, -150, 0] : 0,
                                rotate: scene === 2 ? 180 : 0,
                                scale: scene === 1 ? [1, 1.05, 1] : 1
                            }}
                            transition={{
                                duration: scene === 2 ? 0.8 : 2,
                                repeat: scene === 1 ? Infinity : 0,
                                delay: i * 0.05
                            }}
                            className="relative"
                        >
                            {/* Ghost Trail (Scene 2) */}
                            {scene === 2 && (
                                <motion.div
                                    className="absolute inset-0 blur-md opacity-30"
                                    animate={{ y: [0, 50], opacity: [0.3, 0] }}
                                    transition={{ duration: 0.5 }}
                                    style={{ backgroundColor: COLORS[i] }}
                                />
                            )}

                            <svg width="60" height="60" viewBox="0 0 100 100">
                                <path
                                    d={scene === 1 ? SHAPE_PATHS[i] : interpolators[i](progress)}
                                    fill={COLORS[i]}
                                />
                            </svg>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Scene 3 & 4: Arrival & Wipe */}
            {scene >= 3 && (
                <div className="relative flex items-center gap-8">
                    <motion.div
                        initial={{ x: -200, opacity: 0 }}
                        animate={{
                            x: scene === 4 ? 1200 : 0,
                            opacity: 1,
                            rotate: 360
                        }}
                        transition={{
                            x: { duration: scene === 4 ? 3 : 1, ease: scene === 4 ? "linear" : "backOut" },
                            rotate: { duration: 1, ease: "backOut" }
                        }}
                        className="z-50"
                    >
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-2xl shadow-blue-500/40 border border-blue-400/30">
                            <Zap className="w-10 h-10 text-white fill-current" />
                        </div>
                    </motion.div>

                    <div className="flex gap-4">
                        {LETTER_PATHS.map((_, i) => (
                            <motion.div
                                key={i}
                                animate={{
                                    opacity: scene === 4 ? (progress > (i / 8) ? 0 : 1) : 1,
                                    scale: scene === 4 ? (progress > (i / 8) ? 0 : 1) : 1
                                }}
                                transition={{ duration: 0.4 }}
                            >
                                <svg width="60" height="60" viewBox="0 0 100 100">
                                    <path d={LETTER_PATHS[i]} fill={COLORS[i]} />
                                </svg>
                            </motion.div>
                        ))}
                    </div>

                    {/* Progress Tracker for Wipe Logic */}
                    <div className="hidden">
                        {scene === 4 && (
                            <motion.div
                                animate={{ x: 1 }}
                                transition={{ duration: 3, ease: "linear" }}
                                onUpdate={(latest) => setProgress(Number(latest.x))}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Final Branding Text Arrival */}
            <AnimatePresence>
                {scene === 4 && progress > 0.9 && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="absolute flex flex-col items-center gap-4"
                    >
                        <h1 className="text-6xl font-black italic uppercase tracking-tighter bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                            DiscoverMake
                        </h1>
                        <span className="text-xs font-black uppercase tracking-[0.4em] text-gray-400 italic">
                            Billion Dollar Infrastructure
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
