"use client";

import React, { useRef } from "react";
import { motion, useScroll, useTransform, useSpring, MotionValue } from "framer-motion";

interface ParallaxSeriesProps {
    children: React.ReactNode[];
}

interface ParallaxSectionProps {
    child: React.ReactNode;
    index: number;
    total: number;
    progress: MotionValue<number>;
}

function ParallaxSection({ child, index, total, progress }: ParallaxSectionProps) {
    const start = index / total;
    const end = (index + 1) / total;

    // Parallax effects
    const opacity = useTransform(progress, [start - 0.1, start, end, end + 0.1], [0, 1, 1, 0]);
    const scale = useTransform(progress, [start, end], [1, 0.95]);
    const y = useTransform(progress, [start, end], [0, -100]);
    const backgroundY = useTransform(progress, [start, end], ["0%", "20%"]);

    return (
        <motion.section
            style={{ opacity, scale, y }}
            className="min-h-screen sticky top-0 flex flex-col items-center justify-center overflow-hidden"
        >
            {/* Background Parallax Layer */}
            <motion.div
                style={{ y: backgroundY }}
                className="absolute inset-0 -z-10 opacity-30"
            >
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/5 to-transparent" />
            </motion.div>

            <div className="relative z-10 w-full max-w-7xl mx-auto px-6 font-sans">
                {child}
            </div>
        </motion.section>
    );
}

export function ParallaxSeries({ children }: ParallaxSeriesProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"],
    });

    const smoothProgress = useSpring(scrollYProgress, {
        stiffness: 100,
        damping: 30,
        restDelta: 0.001
    });

    return (
        <div ref={containerRef} className="relative">
            {children.map((child, i) => (
                <ParallaxSection
                    key={i}
                    child={child}
                    index={i}
                    total={children.length}
                    progress={smoothProgress}
                />
            ))}

            {/* Spacer to allow scrolling through the sticky sections */}
            <div style={{ height: `${children.length * 100}vh` }} />
        </div>
    );
}
