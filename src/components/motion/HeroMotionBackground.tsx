"use client";

import React, { useRef, useMemo } from "react";
import { motion, useAnimationFrame, useMotionValue, useTransform } from "framer-motion";

// --- CONFIG ---
const TOTAL_FRAMES = 450;
const TWO_PI = 2 * Math.PI;

const loop = (frame: number, phase = 0): number =>
    Math.sin(((frame % TOTAL_FRAMES) / TOTAL_FRAMES) * TWO_PI + phase);

const loopCos = (frame: number, phase = 0): number =>
    Math.cos(((frame % TOTAL_FRAMES) / TOTAL_FRAMES) * TWO_PI + phase);

// --- COMPONENTS ---

const CircuitGrid: React.FC = () => (
    <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
            backgroundImage: `
        linear-gradient(rgba(139, 92, 246, 0.25) 1px, transparent 1px),
        linear-gradient(90deg, rgba(139, 92, 246, 0.25) 1px, transparent 1px)
      `,
            backgroundSize: "80px 80px",
        }}
    >
        {[
            [240, 160], [560, 480], [880, 320], [1200, 640],
            [1520, 240], [400, 800], [1040, 880], [1680, 560],
        ].map(([x, y], i) => (
            <div key={i} className="absolute w-1 h-1 rounded-full bg-purple-500/40" style={{ left: x, top: y }} />
        ))}
    </div>
);

const FloatingDots: React.FC<{ frame: number }> = ({ frame }) => {
    const dots = [
        { cx: 320, cy: 180, r: 12, color: "#8b5cf6", phase: 0, ampY: 18, opacity: 0.16 },
        { cx: 1580, cy: 260, r: 18, color: "#a78bfa", phase: 1.2, ampY: 22, opacity: 0.12 },
        { cx: 740, cy: 860, r: 10, color: "#7c3aed", phase: 2.4, ampY: 15, opacity: 0.18 },
        { cx: 1200, cy: 140, r: 22, color: "#6d28d9", phase: 3.6, ampY: 25, opacity: 0.1 },
        { cx: 160, cy: 620, r: 14, color: "#c4b5fd", phase: 4.8, ampY: 20, opacity: 0.14 },
        { cx: 1700, cy: 780, r: 16, color: "#9333ea", phase: 5.5, ampY: 17, opacity: 0.13 },
    ];

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden">
            {dots.map((dot, i) => {
                const y = dot.cy + loop(frame, dot.phase) * dot.ampY;
                return (
                    <circle
                        key={i}
                        cx={dot.cx}
                        cy={y}
                        r={dot.r}
                        fill={dot.color}
                        opacity={dot.opacity}
                        className="filter blur-[3px]"
                    />
                );
            })}
        </svg>
    );
};

export function HeroMotionBackground() {
    const frameRef = useRef(0);
    const [frame, setFrame] = React.useState(0);
    const pathRef = useRef<SVGPolylineElement>(null);

    useAnimationFrame((time) => {
        frameRef.current = (time / 33.3) % TOTAL_FRAMES; // ~30fps loop
        setFrame(frameRef.current);
    });

    const panX = useMotionValue(0);
    const sweepX = useTransform(panX, [0, 1], [-600, 2520]);

    React.useEffect(() => {
        const interval = setInterval(() => {
            panX.set((loopCos(frameRef.current) + 1) / 2);
        }, 33);
        return () => clearInterval(interval);
    }, [panX]);

    const polylinePoints = useMemo(() => {
        const points: string[] = [];
        const GRAPH_POINTS = 12;
        const GRAPH_WIDTH = 1400;
        const GRAPH_LEFT = 260;
        const GRAPH_TOP = 480;
        const GRAPH_HEIGHT = 160;

        for (let i = 0; i <= GRAPH_POINTS; i++) {
            const t = i / GRAPH_POINTS;
            const x = GRAPH_LEFT + t * GRAPH_WIDTH;
            const y =
                GRAPH_TOP +
                Math.sin(t * Math.PI * 3 + (frame / TOTAL_FRAMES) * TWO_PI) *
                (GRAPH_HEIGHT * 0.35) +
                Math.cos(t * Math.PI * 1.5 + (frame / TOTAL_FRAMES) * TWO_PI * 0.7) *
                (GRAPH_HEIGHT * 0.2);
            points.push(`${x},${y}`);
        }
        return points.join(" ");
    }, [frame]);

    return (
        <div className="absolute inset-0 z-0 bg-[#0f0a1e] overflow-hidden pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-br from-[#0f0a1e] via-[#1a1145] to-[#0f0a1e] opacity-80" />

            <CircuitGrid />

            {/* Light Sweep */}
            <motion.div
                style={{ left: sweepX }}
                className="absolute top-[-200px] w-[500px] h-[1480px] bg-gradient-to-br from-purple-500/10 via-white/5 to-transparent rotate-[15deg] blur-[60px]"
            />

            {/* Floating Glass Panels */}
            {[
                { w: 260, h: 180, x: 200, y: 250, ax: 90, ay: 45, p: 0, r: -4, lines: 4 },
                { w: 220, h: 150, x: 1400, y: 400, ax: 70, ay: 55, p: Math.PI * 0.6, r: 3, lines: 3 },
                { w: 180, h: 220, x: 900, y: 650, ax: 110, ay: 35, p: Math.PI * 1.2, r: -2, lines: 5 },
                { w: 200, h: 130, x: 500, y: 750, ax: 60, ay: 50, p: Math.PI * 1.8, r: 5, lines: 3 },
            ].map((panel, i) => {
                const x = panel.x + loop(frame, panel.p) * panel.ax;
                const y = panel.y + loopCos(frame, panel.p) * panel.ay;
                const rot = panel.r + loop(frame, panel.p + Math.PI * 0.5) * 2;

                return (
                    <div
                        key={i}
                        className="absolute rounded-2xl border border-white/10 bg-white/5 backdrop-blur-[8px] shadow-2xl opacity-20"
                        style={{
                            width: panel.w,
                            height: panel.h,
                            left: x,
                            top: y,
                            transform: `rotate(${rot}deg)`,
                        }}
                    >
                        <div className="absolute left-3 top-3 flex gap-1">
                            {[0, 1, 2].map(d => <div key={d} className="w-1.5 h-1.5 rounded-full bg-white/20" />)}
                        </div>
                        {/* Inner Lines */}
                        <div className="mt-10 px-4 space-y-3">
                            {Array.from({ length: panel.lines }).map((_, j) => (
                                <div key={j} className="h-[2px] bg-white/10 rounded-full" style={{ width: `${60 + (j % 2) * 20}%` }} />
                            ))}
                        </div>
                    </div>
                );
            })}

            {/* Glowing Graph */}
            <svg className="absolute inset-0 w-full h-full">
                <polyline
                    points={polylinePoints}
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth="2"
                    className="opacity-20 filter blur-[1px]"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>

            <FloatingDots frame={frame} />
        </div>
    );
}
