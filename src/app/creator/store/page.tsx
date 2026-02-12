"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Sparkles,
    Code2,
    Palette,
    DollarSign,
    TrendingUp,
    Eye,
    Copy,
    Star,
    ArrowRight,
    Layers,
    Package,
    ShoppingBag,
    BarChart3,
    Plus,
    ChevronDown,
    Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * US-010: Creator Marketplace (v2)
 * 
 * Creators publish reusable workflows/templates.
 * Seekers can browse, purchase, and "remix" them.
 * Creator analytics: sales, remixes, revenue.
 */

interface CreatorTemplate {
    id: string;
    title: string;
    description: string;
    category: string;
    price: number;
    pricing: "one-time" | "subscription";
    creator: { initials: string; name: string; rating: number };
    stats: { sales: number; remixes: number; views: number; revenue: number };
    tags: string[];
    featured: boolean;
}

const MOCK_TEMPLATES: CreatorTemplate[] = [
    {
        id: "ct1",
        title: "SaaS Starter Kit",
        description: "Full-stack SaaS boilerplate with auth, billing, dashboards, and API. Next.js + Stripe + Firebase.",
        category: "Full Stack",
        price: 149,
        pricing: "one-time",
        creator: { initials: "AR", name: "Alex R.", rating: 4.9 },
        stats: { sales: 287, remixes: 64, views: 3400, revenue: 42763 },
        tags: ["Next.js", "Stripe", "Firebase"],
        featured: true,
    },
    {
        id: "ct2",
        title: "AI Chatbot Framework",
        description: "Production-ready conversational AI with multi-model support, RAG pipeline, and chat UI components.",
        category: "AI/ML",
        price: 29,
        pricing: "subscription",
        creator: { initials: "PS", name: "Priya S.", rating: 4.8 },
        stats: { sales: 156, remixes: 41, views: 2100, revenue: 4524 },
        tags: ["OpenAI", "LangChain", "React"],
        featured: true,
    },
    {
        id: "ct3",
        title: "E-Commerce Workflow",
        description: "Complete storefront with cart, checkout, inventory management, and analytics dashboard.",
        category: "E-Commerce",
        price: 99,
        pricing: "one-time",
        creator: { initials: "KN", name: "Kim N.", rating: 4.9 },
        stats: { sales: 198, remixes: 52, views: 2800, revenue: 19602 },
        tags: ["Shopify", "React", "Tailwind"],
        featured: false,
    },
    {
        id: "ct4",
        title: "Mobile App Template",
        description: "Cross-platform mobile starter with auth flows, push notifications, and offline-first architecture.",
        category: "Mobile",
        price: 79,
        pricing: "one-time",
        creator: { initials: "MJ", name: "Marcus J.", rating: 4.7 },
        stats: { sales: 112, remixes: 28, views: 1600, revenue: 8848 },
        tags: ["React Native", "Expo", "Firebase"],
        featured: false,
    },
    {
        id: "ct5",
        title: "Design System Builder",
        description: "Generate a complete design system from your brand colors. Includes tokens, components, and Figma bridge.",
        category: "Design",
        price: 19,
        pricing: "subscription",
        creator: { initials: "EV", name: "Eva V.", rating: 4.6 },
        stats: { sales: 340, remixes: 89, views: 5200, revenue: 6460 },
        tags: ["Figma", "CSS", "Storybook"],
        featured: true,
    },
];

const CATEGORIES = ["All", "Full Stack", "AI/ML", "E-Commerce", "Mobile", "Design"];

export default function CreatorMarketplace() {
    const [selectedCategory, setSelectedCategory] = useState("All");
    const [searchQuery, setSearchQuery] = useState("");
    const [showCreatorView, setShowCreatorView] = useState(false);

    const filtered = MOCK_TEMPLATES.filter((t) => {
        const matchCategory = selectedCategory === "All" || t.category === selectedCategory;
        const matchSearch = !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase());
        return matchCategory && matchSearch;
    });

    const totalRevenue = MOCK_TEMPLATES.reduce((sum, t) => sum + t.stats.revenue, 0);
    const totalSales = MOCK_TEMPLATES.reduce((sum, t) => sum + t.stats.sales, 0);

    return (
        <div className="min-h-screen bg-[#0B1120] text-white">
            <div className="fixed top-1/3 left-0 w-[500px] h-[500px] bg-purple-600/3 rounded-full blur-[200px] pointer-events-none" />
            <div className="fixed bottom-0 right-0 w-[300px] h-[300px] bg-blue-600/3 rounded-full blur-[120px] pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-40 glass-panel border-b border-white/5">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                            <Package className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="font-black text-lg tracking-tight">Creator Store</p>
                            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest italic">Workflows & Templates</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs font-bold text-white/40 rounded-xl"
                            onClick={() => setShowCreatorView(!showCreatorView)}
                        >
                            <BarChart3 className="w-3.5 h-3.5 mr-1" />
                            {showCreatorView ? "Browse" : "Creator Hub"}
                        </Button>
                        <Button
                            size="sm"
                            className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold text-xs"
                        >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            Publish
                        </Button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                {showCreatorView ? (
                    /* Creator Analytics View */
                    <div>
                        <h2 className="text-2xl font-black tracking-tight mb-6">Creator Analytics</h2>

                        {/* KPI Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                            <div className="glass-card rounded-2xl p-4 text-center">
                                <DollarSign className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
                                <p className="text-2xl font-black">${totalRevenue.toLocaleString()}</p>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Total Revenue</p>
                            </div>
                            <div className="glass-card rounded-2xl p-4 text-center">
                                <ShoppingBag className="w-5 h-5 text-blue-400 mx-auto mb-2" />
                                <p className="text-2xl font-black">{totalSales.toLocaleString()}</p>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Total Sales</p>
                            </div>
                            <div className="glass-card rounded-2xl p-4 text-center">
                                <Copy className="w-5 h-5 text-purple-400 mx-auto mb-2" />
                                <p className="text-2xl font-black">{MOCK_TEMPLATES.reduce((s, t) => s + t.stats.remixes, 0)}</p>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Remixes</p>
                            </div>
                            <div className="glass-card rounded-2xl p-4 text-center">
                                <Eye className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                                <p className="text-2xl font-black">{(MOCK_TEMPLATES.reduce((s, t) => s + t.stats.views, 0) / 1000).toFixed(1)}k</p>
                                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest italic">Views</p>
                            </div>
                        </div>

                        {/* Per-template performance */}
                        <h3 className="text-sm font-black text-white/50 uppercase tracking-widest mb-4 italic">Template Performance</h3>
                        <div className="space-y-3">
                            {MOCK_TEMPLATES.map((template) => (
                                <div key={template.id} className="glass-card rounded-2xl p-4 flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
                                        <Layers className="w-5 h-5 text-violet-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-black truncate">{template.title}</h4>
                                        <div className="flex items-center gap-3 text-[10px] text-white/30 font-medium">
                                            <span>{template.stats.sales} sales</span>
                                            <span>•</span>
                                            <span>{template.stats.remixes} remixes</span>
                                            <span>•</span>
                                            <span>{template.stats.views.toLocaleString()} views</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-emerald-400">${template.stats.revenue.toLocaleString()}</p>
                                        <p className="text-[9px] text-white/20 font-bold italic">
                                            ${template.price}/{template.pricing === "subscription" ? "mo" : "once"}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Browse View — Seeker perspective */
                    <div>
                        {/* Search */}
                        <div className="relative mb-6">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                            <input
                                type="text"
                                placeholder="Search templates and workflows..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl pl-11 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                            />
                        </div>

                        {/* Categories */}
                        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
                            {CATEGORIES.map((cat) => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={cn(
                                        "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all italic",
                                        selectedCategory === cat
                                            ? "bg-white/10 text-white"
                                            : "text-white/30 hover:text-white/50 bg-white/3"
                                    )}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>

                        {/* Featured */}
                        {selectedCategory === "All" && (
                            <div className="mb-8">
                                <h3 className="text-sm font-black text-white/50 uppercase tracking-widest mb-4 flex items-center gap-2 italic">
                                    <Sparkles className="w-4 h-4 text-amber-400" />
                                    Featured
                                </h3>
                                <div className="grid md:grid-cols-2 gap-4">
                                    {filtered.filter((t) => t.featured).map((template) => (
                                        <motion.div
                                            key={template.id}
                                            className="glass-card rounded-3xl p-6 border-violet-500/10 hover:border-violet-500/20 transition-all cursor-pointer"
                                            whileHover={{ scale: 1.01 }}
                                        >
                                            <div className="flex items-start justify-between mb-3">
                                                <div>
                                                    <span className="text-[8px] font-black uppercase tracking-widest text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full italic">
                                                        {template.category}
                                                    </span>
                                                    <h3 className="text-lg font-black tracking-tight mt-2">{template.title}</h3>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-lg font-black text-violet-400">${template.price}</p>
                                                    <p className="text-[8px] text-white/20 font-bold italic">
                                                        {template.pricing === "subscription" ? "/month" : "one-time"}
                                                    </p>
                                                </div>
                                            </div>
                                            <p className="text-xs text-white/40 mb-4 line-clamp-2">{template.description}</p>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-[8px] font-black text-white/50">
                                                        {template.creator.initials}
                                                    </div>
                                                    <span className="text-[10px] text-white/30 font-medium">{template.creator.name}</span>
                                                    <span className="text-[9px] text-amber-400 flex items-center gap-0.5">
                                                        <Star className="w-2.5 h-2.5 fill-amber-400" /> {template.creator.rating}
                                                    </span>
                                                </div>
                                                <div className="flex gap-3 text-[9px] text-white/20 font-medium">
                                                    <span>{template.stats.sales} sales</span>
                                                    <span>{template.stats.remixes} remixes</span>
                                                </div>
                                            </div>
                                            <div className="flex gap-1.5 mt-3 flex-wrap">
                                                {template.tags.map((tag) => (
                                                    <span key={tag} className="text-[8px] font-bold uppercase tracking-widest text-white/20 bg-white/5 px-2 py-0.5 rounded-lg italic">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="flex gap-2 mt-4">
                                                <Button className="flex-1 h-9 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold text-xs">
                                                    Purchase
                                                </Button>
                                                <Button variant="ghost" className="h-9 rounded-xl border border-white/10 text-white/40 font-bold text-xs">
                                                    <Copy className="w-3.5 h-3.5 mr-1" /> Remix
                                                </Button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* All templates grid */}
                        <h3 className="text-sm font-black text-white/50 uppercase tracking-widest mb-4 italic">
                            {selectedCategory === "All" ? "All Templates" : selectedCategory}
                        </h3>
                        <div className="grid md:grid-cols-3 gap-4">
                            {filtered.map((template) => (
                                <motion.div
                                    key={template.id}
                                    className="glass-card rounded-2xl p-4 hover:border-white/10 transition-all cursor-pointer"
                                    whileHover={{ scale: 1.01 }}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[8px] font-black uppercase tracking-widest text-white/30 italic">{template.category}</span>
                                        <span className="text-sm font-black text-violet-400">${template.price}</span>
                                    </div>
                                    <h4 className="text-sm font-black tracking-tight mb-1">{template.title}</h4>
                                    <p className="text-[10px] text-white/30 line-clamp-2 mb-3">{template.description}</p>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-white/20 font-medium">{template.stats.sales} sales</span>
                                        <div className="flex gap-1">
                                            <Button size="sm" className="h-7 rounded-lg bg-violet-600/20 text-violet-400 text-[10px] font-bold px-3 hover:bg-violet-600/30">
                                                Buy
                                            </Button>
                                            <Button size="sm" variant="ghost" className="h-7 rounded-lg text-white/30 text-[10px] font-bold px-2 hover:text-white/50">
                                                <Copy className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
