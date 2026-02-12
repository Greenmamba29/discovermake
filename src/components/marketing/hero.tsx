"use client";

import { useRef, useEffect } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { HeroAIInput } from "./hero-ai-input";
import { FadeIn, MotionBox } from "@/components/ui/motion-primitives";
import { cn } from "@/lib/utils";

const FloatingNode = ({
    delay,
    x,
    y,
    icon,
    size = "md"
}: {
    delay: number;
    x: string;
    y: string;
    icon?: string;
    size?: "sm" | "md" | "lg";
}) => {
    const sizeClasses = {
        sm: "w-8 h-8",
        md: "w-12 h-12",
        lg: "w-16 h-16"
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{
                opacity: [0.2, 0.5, 0.2],
                y: [0, -20, 0],
                x: [0, 10, 0]
            }}
            transition={{
                duration: 5,
                delay: delay,
                repeat: Infinity,
                repeatType: "reverse"
            }}
            className={cn(
                "absolute rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm flex items-center justify-center pointer-events-none z-0",
                sizeClasses[size]
            )}
            style={{ left: x, top: y }}
        >
            {/* Abstract Node Icon */}
            <div className="w-1/2 h-1/2 rounded-full bg-gradient-to-br from-primary/50 to-secondary/50 opacity-80" />
        </motion.div>
    );
};

export const Hero = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end start"],
    });

    const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);
    const opacity = useTransform(scrollYProgress, [0, 1], [1, 0]);

    return (
        <section ref={containerRef} className="relative min-h-[90vh] flex flex-col items-center justify-center overflow-hidden pt-20">

            {/* Animated Background Nodes */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-primary/10 blur-[120px] rounded-full opacity-50" />

                {/* Simulated "Nodes" floating */}
                <FloatingNode delay={0} x="10%" y="20%" size="lg" />
                <FloatingNode delay={2} x="80%" y="15%" size="md" />
                <FloatingNode delay={1} x="20%" y="70%" size="sm" />
                <FloatingNode delay={3} x="75%" y="60%" size="lg" />
                <FloatingNode delay={0.5} x="50%" y="10%" size="sm" />
                <FloatingNode delay={4} x="5%" y="50%" size="md" />
                <FloatingNode delay={1.5} x="90%" y="40%" size="sm" />

                {/* Connecting Lines (SVG overlay could be added here for extra polish) */}
            </div>

            {/* Main Content */}
            <motion.div
                style={{ y, opacity }}
                className="relative z-10 w-full px-4 text-center max-w-4xl mx-auto space-y-8"
            >
                <FadeIn delay={0.2} direction="up">
                    <MotionBox className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-xl mb-6">
                        <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                        <span className="text-xs font-medium text-neutral-300 tracking-wide uppercase">
                            The #1 AI Automation Marketplace
                        </span>
                    </MotionBox>
                </FadeIn>

                <FadeIn delay={0.4}>
                    <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-white/50 mb-6 font-sans">
                        Automate <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
                            Everything.
                        </span>
                    </h1>
                </FadeIn>

                <FadeIn delay={0.6}>
                    <p className="text-xl md:text-2xl text-neutral-400 max-w-2xl mx-auto mb-12 font-light leading-relaxed">
                        Discover thousands of production-ready Make.com blueprints. <br className="hidden md:block" />
                        Import, connect, and launch in seconds.
                    </p>
                </FadeIn>

                <FadeIn delay={0.8} className="w-full">
                    <HeroAIInput />
                </FadeIn>

                {/* Stats / Social Proof */}
                <FadeIn delay={1.2} className="pt-20 grid grid-cols-3 gap-8 text-center opacity-60">
                    <div>
                        <div className="text-3xl font-bold text-white">10k+</div>
                        <div className="text-sm text-neutral-500">Templates</div>
                    </div>
                    <div>
                        <div className="text-3xl font-bold text-white">50M+</div>
                        <div className="text-sm text-neutral-500">Executions</div>
                    </div>
                    <div>
                        <div className="text-3xl font-bold text-white">24/7</div>
                        <div className="text-sm text-neutral-500">Concierge</div>
                    </div>
                </FadeIn>
            </motion.div>
        </section>
    );
};
