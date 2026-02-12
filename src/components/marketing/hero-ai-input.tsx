"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, Command } from "lucide-react";
import { cn } from "@/lib/utils";

const PLACEHOLDERS = [
    "connect Notion to Slack...",
    "save new leads to Airtable...",
    "summarize emails with GPT-4...",
    "post Instagram photos to Twitter...",
];

export const HeroAIInput = () => {
    const [inputValue, setInputValue] = useState("");
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [isThinking, setIsThinking] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    // Typewriter effect logic for placeholder
    const [displayText, setDisplayText] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);
    const [typingSpeed, setTypingSpeed] = useState(150);

    useEffect(() => {
        const handleTyping = () => {
            const currentPlaceholder = PLACEHOLDERS[placeholderIndex];
            const shouldDelete = isDeleting;

            setDisplayText(current => {
                if (shouldDelete) {
                    return currentPlaceholder.substring(0, current.length - 1);
                } else {
                    return currentPlaceholder.substring(0, current.length + 1);
                }
            });

            if (!shouldDelete && displayText === currentPlaceholder) {
                setTimeout(() => setIsDeleting(true), 1500); // Pause at end
            } else if (shouldDelete && displayText === "") {
                setIsDeleting(false);
                setPlaceholderIndex((current) => (current + 1) % PLACEHOLDERS.length);
            }
        };

        const timer = setTimeout(handleTyping, isDeleting ? 75 : typingSpeed);
        return () => clearTimeout(timer);
    }, [displayText, isDeleting, placeholderIndex, typingSpeed]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim()) return;

        setIsThinking(true);
        // Simulate AI processing
        setTimeout(() => {
            setIsThinking(false);
            // Navigate or show results would go here
            console.log("Searching for:", inputValue);
        }, 2000);
    };

    return (
        <div className="w-full max-w-2xl mx-auto relative z-20">
            <form onSubmit={handleSubmit} className="relative group">
                <div
                    className={cn(
                        "relative flex items-center w-full p-2 overflow-hidden rounded-2xl bg-black/50 border border-white/10 backdrop-blur-xl transition-all duration-300",
                        isFocused ? "ring-2 ring-primary/50 scale-[1.01] border-primary/30" : "hover:border-white/20"
                    )}
                >
                    <div className="pl-4 pr-2 text-primary">
                        {isThinking ? (
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            >
                                <Sparkles className="w-6 h-6" />
                            </motion.div>
                        ) : (
                            <Command className="w-6 h-6 opacity-50" />
                        )}
                    </div>

                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        className="w-full bg-transparent border-none outline-none text-lg text-white placeholder-transparent h-14 px-2"
                    />

                    {/* Custom Placeholder Overlay */}
                    {!inputValue && (
                        <div className="absolute left-14 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500 text-lg">
                            <span>I want to </span>
                            <span className="text-neutral-300">{displayText}</span>
                            <span className="animate-pulse">|</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        className={cn(
                            "ml-2 flex items-center justify-center p-3 rounded-xl transition-all duration-300",
                            inputValue.trim()
                                ? "bg-primary text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] cursor-pointer"
                                : "bg-white/5 text-neutral-500 cursor-default"
                        )}
                        disabled={!inputValue.trim()}
                    >
                        {isThinking ? (
                            <span className="text-sm font-semibold px-2">Analyzing...</span>
                        ) : (
                            <ArrowRight className="w-5 h-5" />
                        )}
                    </button>
                </div>

                {/* Glow effect under the input */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-secondary rounded-2xl opacity-20 blur-xl group-hover:opacity-40 transition duration-500 -z-10" />
            </form>

            {/* Suggested Chips */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1 }}
                className="flex flex-wrap items-center justify-center gap-2 mt-6"
            >
                <span className="text-sm text-neutral-500 mr-2">Try:</span>
                {[
                    "Content Calendar 📅",
                    "Lead Gen 🚀",
                    "Crypto Bot 🤖",
                    "SEO Auto-blog ✍️"
                ].map((tag) => (
                    <button
                        key={tag}
                        onClick={() => setInputValue(tag)}
                        className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-neutral-300"
                    >
                        {tag}
                    </button>
                ))}
            </motion.div>
        </div>
    );
};
