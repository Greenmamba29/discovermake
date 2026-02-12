"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { CheckCircle2, TrendingUp, User } from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";

// --- Sales Ticker Component ---
const MOCK_SALES = [
    { user: "Alex M.", item: "Notion to Slack Sync", time: "2m ago" },
    { user: "Sarah K.", item: "Lead Gen Scraper", time: "5m ago" },
    { user: "Mike R.", item: "SEO Auto-Blogger", time: "12m ago" },
    { user: "Company X", item: "CRM Enrichment V2", time: "15m ago" },
];

export const SalesTicker = () => {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setIndex((prev) => (prev + 1) % MOCK_SALES.length);
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    const sale = MOCK_SALES[index];

    return (
        <div className="fixed bottom-4 left-4 z-50">
            <AnimatePresence mode="wait">
                <motion.div
                    key={sale.item} // Key changes to trigger animation
                    initial={{ opacity: 0, y: 20, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.9 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center gap-3 bg-black/80 backdrop-blur-md border border-white/10 p-3 rounded-xl shadow-2xl"
                >
                    <div className="bg-green-500/20 p-2 rounded-full">
                        <TrendingUp className="w-5 h-5 text-green-500" />
                    </div>
                    <div className="text-sm">
                        <p className="text-white font-medium">
                            <span className="text-neutral-400">{sale.user} purchased</span>
                        </p>
                        <p className="text-primary font-semibold">{sale.item}</p>
                    </div>
                    <span className="text-xs text-neutral-500 ml-2">{sale.time}</span>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};

// --- Creator Profile Component ---
export const CreatorProfileCard = ({
    name,
    role,
    verified = false,
    sales,
    image
}: {
    name: string;
    role: string;
    verified?: boolean;
    sales: string;
    image?: string;
}) => {
    return (
        <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group">
            <div className="relative w-12 h-12 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center border border-white/10">
                {image ? (
                    <Image src={image} alt={name} fill className="object-cover" />
                ) : (
                    <User className="w-6 h-6 text-neutral-400" />
                )}
            </div>
            <div>
                <div className="flex items-center gap-1">
                    <h4 className="font-semibold text-white group-hover:text-primary transition-colors">{name}</h4>
                    {verified && <CheckCircle2 className="w-4 h-4 text-blue-500 fill-blue-500/10" />}
                </div>
                <p className="text-xs text-neutral-400">{role}</p>
            </div>
            <div className="ml-auto text-right">
                <p className="text-sm font-bold text-white">{sales}</p>
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">Sales</p>
            </div>
        </div>
    );
};
