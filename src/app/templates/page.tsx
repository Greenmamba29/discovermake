

import { getAllTemplates } from "@/lib/templates";
import { Sparkles } from "lucide-react";
import { TemplatesClient } from "@/components/templates-client";

export const metadata = {
    title: "Template Directory | DiscoverMake",
    description: "Browse our collection of premium Make.com automation templates.",
};

export default async function TemplatesPage({
    searchParams
}: {
    searchParams: Promise<{ page?: string; search?: string; category?: string; complexity?: string }>
}) {
    const { page: pageStr, search, category, complexity } = await searchParams;
    const page = Number(pageStr) || 1;
    const { templates, total } = await getAllTemplates(page, 24, search, category, complexity);

    // Calculate total time saved (Mock MVP logic based on visible templates + estimation)
    const totalHoursSaved = templates.reduce((acc, t) => acc + (t.monthlyHoursSaved || 0), 0);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-slate-200">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-12 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold mb-4 border border-blue-500/20">
                                <Sparkles className="w-3 h-3" />
                                <span>{total} Premium Templates</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-4 tracking-tight">
                                Explore <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">Automation</span>
                            </h1>
                            <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl">
                                Expertly crafted blueprints to save you time and revenue.
                            </p>
                        </div>

                        {/* Time Wealth Counter */}
                        <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700">
                            <div className="text-sm text-slate-500 mb-1">Community Time Wealth</div>
                            <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
                                {Math.round(totalHoursSaved).toLocaleString()} <span className="text-sm text-slate-400 font-normal">hours/mo</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-12">
                <TemplatesClient templates={templates} total={total} currentPage={page} />
            </div>
        </div>
    );
}
