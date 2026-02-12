"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Search,
    Bell,
    Bolt,
    Heart,
    CheckCircle,
    User,
    TrendingUp,
    Clock,
    Zap,
    ChevronRight,
    SlidersHorizontal,
    Star,
    Layout as LayoutIcon,
    Brain,
    Rocket,
    Smartphone,
    Code2,
    Database,
    ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { GlassPanel, IronButton, RetroStrata, ProgressBar, DesignSystem } from "@/components/ui/DesignSystem";
import Link from "next/link";
import Image from "next/image";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";
import { CheckoutOverlay } from "@/components/marketplace/CheckoutOverlay";
import { Template } from "@/types";

/**
 * Hi-Fi Marketplace Discovery Home
 * Overhaul based on assets/stitch_screens_2/stitch_creator_marketplace_explorer/marketplace_discovery_home
 */

interface WorkflowCardProps {
    title: string;
    creator: {
        name: string;
        avatar: string;
        isVerified: boolean;
    };
    stats: {
        remixes: string;
        time: string;
    };
    category: string;
    imageUrl: string;
    staffPick?: boolean;
    onPurchase?: (id: string, name: string, price: number) => void;
}

const CATEGORIES = [
    { id: "all", label: "Explore All", icon: Rocket },
    { id: "ai", label: "AI Agents", icon: Brain },
    { id: "dashboards", label: "Dashboards", icon: LayoutIcon },
    { id: "saas", label: "SaaS Kits", icon: Smartphone },
    { id: "automation", label: "Automation", icon: Bolt },
];

function WorkflowCard({ title, creator, stats, imageUrl, staffPick, onPurchase }: WorkflowCardProps) {
    const slug = title.toLowerCase().replace(/\s+/g, '-');
    return (
        <Link href={`/templates/${slug}`} className="block transition-transform hover:scale-[1.02] active:scale-[0.98]">
            <div className="min-w-[280px] w-72 bg-white/5 backdrop-blur-xl rounded-2xl overflow-hidden border border-white/10 group hover:border-blue-500/30 transition-all snap-start">
                <div className="relative h-44 overflow-hidden">
                    <Image src={imageUrl} alt={title} fill className="object-cover opacity-60 group-hover:opacity-80 group-hover:scale-105 transition-all duration-500" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] to-transparent opacity-80" />

                    {staffPick && (
                        <div className="absolute top-3 left-3 bg-blue-500/90 backdrop-blur px-2.5 py-1 rounded-lg border border-white/20">
                            <span className="text-[10px] text-white font-black uppercase tracking-widest italic">Staff Pick</span>
                        </div>
                    )}

                    <button className="absolute top-3 right-3 w-9 h-9 bg-black/40 backdrop-blur rounded-full flex items-center justify-center text-white hover:text-red-400 transition-colors">
                        <Heart className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="relative w-6 h-6">
                            <Image src={creator.avatar} className="rounded-full border border-white/20 object-cover" alt={creator.name} fill />
                            {creator.isVerified && (
                                <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full p-0.5 border border-[#0B1120] z-10">
                                    <CheckCircle className="w-2.5 h-2.5 text-white" />
                                </div>
                            )}
                        </div>
                        <span className="text-[11px] text-gray-400 font-bold tracking-tight">{creator.name}</span>
                    </div>

                    <h3 className="text-base font-bold text-white line-clamp-1 group-hover:text-blue-400 transition-colors">{title}</h3>

                    <div className="flex items-center gap-4 text-[10px] text-gray-500 font-bold uppercase tracking-widest italic">
                        <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-blue-400" /> {stats.remixes} remixes</span>
                        <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-blue-400" /> {stats.time}</span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                        <div className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle className="w-2.5 h-2.5 text-emerald-400" />
                            <span className="text-[8px] font-black uppercase tracking-tighter text-emerald-400 italic">Stripe Connected</span>
                        </div>
                    </div>

                    <IronButton
                        variant="primary"
                        size="sm"
                        className="w-full h-10 text-[11px] uppercase italic"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onPurchase?.(slug, title, 49); // Default price for now
                        }}
                    >
                        Remix Workflow
                    </IronButton>
                </div>
            </div>
        </Link>
    );
}

export default function MarketplacePage() {
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [trending, setTrending] = useState<Template[]>([]);
    const [roleBased, setRoleBased] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<{ id: string, name: string, price: number } | null>(null);

    useEffect(() => {
        async function fetchTemplates() {
            setLoading(true);
            try {
                const res = await fetch(`/api/templates?limit=12&category=${selectedCategory === "all" ? "" : selectedCategory}&search=${searchQuery}`);
                const data = await res.json();
                setTrending(data.templates || []);
                setRoleBased((data.templates || []).slice().reverse().slice(0, 4));
            } catch (e) {
                console.error("Failed to fetch templates:", e);
            } finally {
                setLoading(false);
            }
        }
        fetchTemplates();
    }, [selectedCategory, searchQuery]);

    const handlePurchaseInitiation = (templateId: string, name: string, price: number) => {
        setSelectedTemplate({ id: templateId, name, price });
        setCheckoutOpen(true);
    };

    const handlePurchaseConfirm = async (templateId: string, name: string, price: number) => {
        try {
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateId,
                    price,
                    userId: 'test-user-123', // Hardcoded for test run
                    email: 'paco@example.com',
                    plan: 'standard',
                }),
            });

            const data = await response.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                toast.error(data.error || "Failed to initialize protocol");
            }
        } catch (error) {
            console.error('Purchase Error:', error);
            toast.error("Internal Server Error");
        }
    };

    const mapTemplateToCard = (t: Template): WorkflowCardProps => ({
        title: t.name,
        creator: {
            name: "Verified Creator",
            avatar: `https://i.pravatar.cc/100?u=${t.id}`,
            isVerified: true
        },
        stats: {
            remixes: t.totalSales > 1000 ? `${(t.totalSales / 1000).toFixed(1)}k` : String(t.totalSales),
            time: `${t.setupTime} mins`
        },
        category: t.category,
        imageUrl: t.coverImage,
    });

    return (
        <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">

            {/* AMBIENT MOTION BACKGROUND */}
            <div className="fixed inset-0 opacity-[0.03] pointer-events-none origin-center scale-125">
                <HeroMotionBackground />
            </div>

            {/* 1. STICKY SEARCH & FILTERS */}
            <header className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-xl border-b border-white/5 px-6 py-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                                <Bolt className="w-6 h-6 text-white fill-current" />
                            </div>
                            <h1 className="text-xl font-black tracking-tight uppercase italic text-white">The Forge</h1>
                        </div>
                        <div className="flex items-center gap-3">
                            <button className="p-2 text-gray-500 hover:text-white transition-colors">
                                <Bell className="w-5 h-5" />
                            </button>
                            <div className="w-8 h-8 rounded-full border border-blue-500/30 bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100)' }} />
                        </div>
                    </div>

                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 z-10" />
                        <input
                            type="text"
                            placeholder="What do you want to build today?"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-12 text-sm font-bold placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all italic"
                        />
                        <button className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors">
                            <SlidersHorizontal className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Filter Chips */}
                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={cn(
                                    "px-5 py-2 rounded-full text-[10px] font-black uppercase italic tracking-widest transition-all whitespace-nowrap flex items-center gap-2 border",
                                    selectedCategory === cat.id
                                        ? "bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/20"
                                        : "bg-white/5 border-white/10 text-gray-500 hover:text-gray-300"
                                )}
                            >
                                <cat.icon className="w-3 h-3" />
                                {cat.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-12 space-y-16 pb-40">

                {/* 2. TRENDING / SEARCH RESULTS */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-black tracking-tight uppercase italic flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-blue-500" />
                                {searchQuery ? "Search Results" : "Trending Now"}
                            </h2>
                            <p className="text-[9px] font-black uppercase text-gray-500 tracking-widest italic mt-0.5">
                                {searchQuery ? `${trending.length} matching refineries` : "Top performing software engines"}
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-6 overflow-x-auto no-scrollbar snap-x pb-4">
                        {loading ? (
                            Array(3).fill(0).map((_, i) => (
                                <div key={i} className="min-w-[300px] w-80 h-[420px] bg-white/5 animate-pulse rounded-[2rem] border border-white/5" />
                            ))
                        ) : trending.length > 0 ? (
                            trending.map((t) => (
                                <WorkflowCard
                                    key={t.id}
                                    {...mapTemplateToCard(t)}
                                    onPurchase={handlePurchaseInitiation}
                                />
                            ))
                        ) : (
                            <div className="w-full py-20 text-center border border-dashed border-white/10 rounded-[2rem]">
                                <p className="text-gray-500 italic font-bold">No biological signals detected for this query.</p>
                            </div>
                        )}
                    </div>
                </section>

                {/* 3. FOR YOUR ROLE */}
                {!searchQuery && (
                    <section className="bg-blue-600/5 rounded-[2.5rem] p-8 border border-blue-500/10 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Star className="w-24 h-24 text-blue-400 fill-current" />
                        </div>
                        <div className="flex items-center justify-between mb-8 relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="size-12 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                                    <Star className="w-6 h-6 text-blue-400 fill-current" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black tracking-tight uppercase italic">For Your Role</h2>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-500 italic mt-0.5">Curated for Network Intelligence</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-6 overflow-x-auto no-scrollbar snap-x relative z-10">
                            {roleBased.map((t) => (
                                <WorkflowCard
                                    key={t.id}
                                    {...mapTemplateToCard(t)}
                                    onPurchase={handlePurchaseInitiation}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* 3. Staff Pick (Static for now, could be first item) */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-black tracking-tight">Staff Pick</h2>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-[2rem] overflow-hidden group hover:border-blue-500/20 transition-all">
                        <div className="relative h-56 overflow-hidden">
                            <Image
                                src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2000"
                                fill
                                className="object-cover opacity-50 group-hover:scale-105 transition-transform duration-700"
                                alt="Staff Pick"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] via-transparent to-transparent" />
                            <div className="absolute top-6 left-6">
                                <RetroStrata label="Verified Top Choice" variant="premium" pulse />
                            </div>
                        </div>
                        <div className="p-6">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-2xl font-black tracking-tight group-hover:text-blue-400 transition-colors">Advanced LinkedIn Automation V2</h3>
                                    <p className="text-sm text-gray-500 mt-1 max-w-md italic">Complete outbound engine for B2B sales leads. Includes automatic personalization and CRM sync.</p>
                                </div>
                                <div className="text-right">
                                    <span className="text-2xl font-black text-white">$49</span>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">One-time</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                <div className="flex -space-x-3">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="w-8 h-8 rounded-full border-2 border-[#0B1120] bg-cover bg-center" style={{ backgroundImage: `url(https://i.pravatar.cc/100?img=${i + 10})` }} />
                                    ))}
                                    <div className="w-8 h-8 rounded-full border-2 border-[#0B1120] bg-gray-800 flex items-center justify-center text-[10px] font-black">+12</div>
                                </div>
                                <IronButton
                                    variant="primary"
                                    className="px-10 h-10 italic uppercase border border-blue-400 shadow-xl shadow-blue-500/20"
                                    onClick={() => handlePurchaseInitiation('advanced-linkedin-automation-v2', 'Advanced LinkedIn Automation V2', 49)}
                                >
                                    Remix
                                </IronButton>
                            </div>
                        </div>
                    </div>
                </section>
                {/* 4. BUG BOUNTY ITEMS */}
                <section>
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-xl font-black tracking-tight uppercase italic flex items-center gap-2">
                                <Database className="w-5 h-5 text-emerald-500" />
                                Registry Bounties
                            </h2>
                            <p className="text-[9px] font-black uppercase text-gray-500 tracking-widest italic mt-0.5">Vetted protocol signals for immediate resolution</p>
                        </div>
                        <Link href="/marketplace/bounty">
                            <IronButton variant="secondary" size="sm" className="h-9 px-4 text-[10px] uppercase font-black italic">
                                View Registry
                            </IronButton>
                        </Link>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {[
                            { title: "Protocol Latency in AuthNode V2", reward: "1,200 Credits", severity: "High", type: "Performance" },
                            { title: "CSS Injection in Previewer", reward: "800 Credits", severity: "Critical", type: "Security" }
                        ].map((bounty, i) => (
                            <Link href="/marketplace/bounty" key={i}>
                                <GlassPanel variant="subtle" className="p-6 rounded-[2rem] border-white/5 flex items-center justify-between group hover:border-emerald-500/20 transition-all cursor-pointer">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-sm font-black text-white group-hover:text-emerald-400 transition-colors uppercase italic tracking-tight">{bounty.title}</h3>
                                            <RetroStrata label={bounty.severity} variant={bounty.severity === 'Critical' ? 'error' : 'warning'} />
                                        </div>
                                        <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest text-gray-500 italic">
                                            <span>{bounty.type} Protocol</span>
                                            <div className="size-1 rounded-full bg-gray-700" />
                                            <span>Active Signal</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-lg font-black italic tracking-tighter text-white">{bounty.reward}</p>
                                        <p className="text-[8px] font-black uppercase text-emerald-400 tracking-widest italic">Instant Payout</p>
                                    </div>
                                </GlassPanel>
                            </Link>
                        ))}
                    </div>
                </section>
            </main>

            {/* Bottom Nav */}
            <nav className="fixed bottom-0 left-0 right-0 h-20 bg-[#0B1120]/80 backdrop-blur-2xl border-t border-white/5 z-50">
                <div className="max-w-md mx-auto h-full flex items-center justify-around px-2">
                    <Link href="/">
                        <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition-colors group">
                            <Rocket className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            <span className="text-[9px] font-black uppercase italic">Home</span>
                        </button>
                    </Link>
                    <button className="flex flex-col items-center gap-1 text-blue-400 group">
                        <Search className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        <span className="text-[9px] font-black uppercase italic">Discover</span>
                    </button>
                    <Link href="/architect">
                        <div className="relative -top-8">
                            <button className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-[0_8px_25px_rgba(59,130,246,0.4)] border-4 border-[#0B1120] hover:scale-105 active:scale-95 transition-all">
                                <Bolt className="w-8 h-8 fill-current" />
                            </button>
                        </div>
                    </Link>
                    <Link href="/dashboard/maker">
                        <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition-colors group">
                            <LayoutIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            <span className="text-[9px] font-black uppercase italic">Remixes</span>
                        </button>
                    </Link>
                    <Link href="/onboarding">
                        <button className="flex flex-col items-center gap-1 text-gray-500 hover:text-white transition-colors group">
                            <User className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            <span className="text-[9px] font-black uppercase italic">Profile</span>
                        </button>
                    </Link>
                </div>
            </nav>

            {/* Checkout Protocol Layer */}
            {selectedTemplate && (
                <CheckoutOverlay
                    isOpen={checkoutOpen}
                    onClose={() => setCheckoutOpen(false)}
                    template={selectedTemplate}
                    onConfirm={handlePurchaseConfirm}
                />
            )}
        </div>
    );
}
