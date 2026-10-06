import type { Config } from "tailwindcss";

/**
 * DiscoverMake visual system (workflow 10):
 * - graphite app UI (#0c0e0d -> #1a1d1c), warm-white editorial surfaces (marketing, passport)
 * - ONE signal color: green #5fe08a (makeability, accepted, production activity)
 * - red is reserved for LIVE only; warnings/errors use amber/ember, never red
 * - Archivo (display, width axis) + JetBrains Mono (technical data)
 */
const config: Config = {
    darkMode: ["class"],
    content: [
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                graphite: {
                    950: "#0c0e0d",
                    900: "#111413",
                    850: "#151817",
                    800: "#1a1d1c",
                    750: "#202423",
                    700: "#272b2a",
                    600: "#343938",
                    500: "#4b5150",
                },
                fg: {
                    DEFAULT: "#eceeeb",
                    muted: "#a9afab",
                    subtle: "#8b928e",
                },
                signal: {
                    DEFAULT: "#5fe08a",
                    strong: "#7ff0a4",
                    dim: "#2f6e45",
                    ink: "#0b1f12",
                },
                live: "#ff4d4f",
                amber: { DEFAULT: "#f2b544", ink: "#2a1d05" },
                ember: { DEFAULT: "#f0884b", ink: "#2b1406" },
                paper: {
                    DEFAULT: "#f6f3ec",
                    raised: "#fffdf8",
                    line: "#e2ddd1",
                },
                ink: {
                    DEFAULT: "#151716",
                    muted: "#53585a",
                    subtle: "#6b7072",
                },
                // shadcn-compatible tokens (kept for sonner / any remaining primitives)
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
            },
            fontFamily: {
                sans: ["var(--font-archivo)", "ui-sans-serif", "system-ui", "sans-serif"],
                display: ["var(--font-archivo)", "ui-sans-serif", "system-ui", "sans-serif"],
                mono: ["var(--font-jetbrains)", "ui-monospace", "SFMono-Regular", "monospace"],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            keyframes: {
                "price-tick": {
                    "0%": { opacity: "0.35", transform: "translateY(3px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
                shimmer: {
                    "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" },
                },
            },
            animation: {
                "price-tick": "price-tick 220ms ease-out",
                shimmer: "shimmer 1.6s linear infinite",
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};
export default config;
