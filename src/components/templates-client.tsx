"use client";

import { Template } from "@/types";
import { TemplateGrid } from "@/components/TemplateGrid";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button"; // Added Button import

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, Check, X } from "lucide-react"; // Consolidated lucide-react imports

interface TemplatesClientProps {
    templates: Template[];
    total: number;
    currentPage: number;
}

export function TemplatesClient({ templates, total, currentPage }: TemplatesClientProps) {
    const [showMobileFilters, setShowMobileFilters] = useState(false); // Restored showMobileFilters state
    const router = useRouter();
    const searchParams = useSearchParams();

    // URL-driven Filter Logic
    const currentCategory = searchParams.get("category") || "All";
    const currentComplexity = searchParams.get("complexity") || "";
    const currentSearch = searchParams.get("search") || "";

    const updateFilters = (newFilters: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams.toString());
        Object.entries(newFilters).forEach(([key, value]) => {
            if (value === null || value === "All" || value === "") {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });
        params.set("page", "1"); // Reset to page 1 on filter change
        router.push(`/templates?${params.toString()}`);
    };

    const handlePageChange = (newPage: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("page", newPage.toString());
        router.push(`/templates?${params.toString()}`);
    };

    const categories = ["All", "Sales", "Marketing", "Productivity", "Operations", "Dev"]; // Curated for MVP
    const COMPLEXITIES = ["Beginner", "Intermediate", "Advanced"];

    const totalPages = Math.ceil(total / 24);

    return (
        <div className="flex flex-col gap-8">
            {/* Search Bar */}
            <div className="relative max-w-2xl mx-auto w-full mb-4">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                    type="text"
                    placeholder="Search 16,000+ templates (e.g. Shopify, Slack, AI...)"
                    className="w-full pl-12 pr-4 py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    defaultValue={currentSearch}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            updateFilters({ search: (e.target as HTMLInputElement).value });
                        }
                    }}
                />
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Mobile Filter Toggle */}
                <button
                    onClick={() => setShowMobileFilters(!showMobileFilters)}
                    className="lg:hidden flex items-center justify-center gap-2 w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
                >
                    <SlidersHorizontal className="w-4 h-4" /> Filters
                </button>

                {/* Sidebar */}
                <aside className={`
                ${showMobileFilters ? 'block' : 'hidden'} lg:block 
                w-full lg:w-64 space-y-8 shrink-0 transition-all
            `}>
                    {/* Categories */}
                    <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Categories</h3>
                        <ul className="space-y-2 text-sm text-slate-500 dark:text-slate-400">
                            {categories.map(cat => (
                                <li
                                    key={cat}
                                    onClick={() => updateFilters({ category: cat })}
                                    className={`cursor-pointer transition-colors flex items-center justify-between p-2 rounded-lg
                                    ${currentCategory === cat ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}
                                `}
                                >
                                    {cat}
                                    {currentCategory === cat && <Check className="w-3.5 h-3.5" />}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Complexity */}
                    <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Complexity</h3>
                        <ul className="space-y-2 text-sm text-slate-500 dark:text-slate-400">
                            {COMPLEXITIES.map(level => (
                                <li
                                    key={level}
                                    onClick={() => updateFilters({ complexity: currentComplexity === level ? "" : level })}
                                    className={`cursor-pointer flex items-center gap-2 p-2 rounded-lg
                                     ${currentComplexity === level ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}
                                `}
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center
                                    ${currentComplexity === level ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600'}
                                `}>
                                        {currentComplexity === level && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    {level}
                                </li>
                            ))}
                        </ul>
                    </div>
                </aside>

                {/* Grid */}
                <div className="flex-1 space-y-8">
                    <div className="flex justify-between items-center text-sm text-slate-500">
                        <div>
                            Showing <span className="font-bold text-slate-900 dark:text-white">{(currentPage - 1) * 24 + 1} - {Math.min(currentPage * 24, total)}</span> of {total.toLocaleString()} results
                        </div>
                    </div>

                    <TemplateGrid templates={templates} />

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex justify-center items-center gap-2 pt-8">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handlePageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>

                            <div className="flex items-center gap-1">
                                <span className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold">
                                    {currentPage}
                                </span>
                                <span className="text-slate-400 px-2 font-medium">of</span>
                                <span className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                                    {totalPages}
                                </span>
                            </div>

                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handlePageChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                            >
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
