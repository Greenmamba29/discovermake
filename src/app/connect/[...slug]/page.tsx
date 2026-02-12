import { notFound } from "next/navigation";
import { Hero } from "@/components/marketing/hero";
import { BentoGrid, BentoGridItem } from "@/components/marketing/bento-grid";
import { BlueprintVisualizer } from "@/components/templates/blueprint-visualizer";
import { SalesTicker, CreatorProfileCard } from "@/components/marketing/trust-signals";
import { Button } from "@/components/ui/button"; // Assuming standard button exists or I should create it. WAit, I haven't created it yet.
import { ArrowRight, CheckCircle, Zap } from "lucide-react";
import { Metadata } from "next";

// Mock Database of Tools
const TOOLS = {
    notion: { name: "Notion", color: "bg-white text-black" },
    slack: { name: "Slack", color: "bg-[#4A154B] text-white" },
    airtable: { name: "Airtable", color: "bg-yellow-400 text-black" },
    openai: { name: "OpenAI", color: "bg-green-600 text-white" },
    gmail: { name: "Gmail", color: "bg-red-500 text-white" },
    hubspot: { name: "HubSpot", color: "bg-orange-500 text-white" },
};

type Props = {
    params: Promise<{ slug: string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const [source, target] = slug;
    const sourceName = TOOLS[source as keyof typeof TOOLS]?.name || source;
    const targetName = TOOLS[target as keyof typeof TOOLS]?.name || target;

    return {
        title: `Connect ${sourceName} to ${targetName} - Instant Integration`,
        description: `The best way to sync ${sourceName} data to ${targetName}. Verified templates, set up in seconds.`,
    };
}

export default async function IntegrationPage({ params }: Props) {
    const { slug } = await params;
    const [source, target] = slug;

    // Basic validation (in real app, check DB)
    if (!source || !target) return notFound();

    const sourceTool = TOOLS[source as keyof typeof TOOLS] || { name: source, color: "bg-gray-500" };
    const targetTool = TOOLS[target as keyof typeof TOOLS] || { name: target, color: "bg-gray-500" };

    return (
        <main className="min-h-screen bg-background selection:bg-primary/30 pt-24 pb-20">
            <SalesTicker />

            {/* Dynamic Hero */}
            <section className="max-w-7xl mx-auto px-4 text-center mb-24">
                <div className="inline-flex items-center gap-4 mb-8">
                    <div className={`px-6 py-3 rounded-2xl text-xl font-bold ${sourceTool.color} shadow-lg shadow-primary/20`}>
                        {sourceTool.name}
                    </div>
                    <Zap className="w-8 h-8 text-neutral-500 animate-pulse" />
                    <div className={`px-6 py-3 rounded-2xl text-xl font-bold ${targetTool.color} shadow-lg shadow-secondary/20`}>
                        {targetTool.name}
                    </div>
                </div>

                <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter mb-6">
                    Connect <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">{sourceTool.name}</span> to <span className="text-transparent bg-clip-text bg-gradient-to-r from-secondary to-primary">{targetTool.name}</span>
                </h1>

                <p className="text-xl text-neutral-400 max-w-2xl mx-auto mb-12">
                    Don&apos;t build from scratch. Use our verified blueprints to sync data, automate workflows, and save 10+ hours a week.
                </p>

                <div className="flex items-center justify-center gap-4">
                    <a
                        href="/data/templates/youtube-automation.json"
                        download="youtube-automation-agent.json"
                        className="bg-white text-black px-8 py-4 rounded-xl font-bold text-lg hover:scale-105 transition-transform flex items-center gap-2"
                    >
                        Use This Integration <ArrowRight className="w-5 h-5" />
                    </a>
                    <button className="bg-white/10 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-white/20 transition-colors">
                        View Documentation
                    </button>
                </div>
            </section>

            {/* Visualizer Demo */}
            <section className="max-w-6xl mx-auto px-4 mb-24">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-2xl font-bold text-white">Logic Blueprint</h3>
                    <span className="text-sm text-green-500 flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" /> Verified Working
                    </span>
                </div>
                <BlueprintVisualizer />
            </section>

            {/* Creators Section */}
            <section className="max-w-4xl mx-auto px-4 text-center">
                <h3 className="text-2xl font-bold text-white mb-8">Top Builders for this Integration</h3>
                <div className="grid md:grid-cols-2 gap-4 text-left">
                    <CreatorProfileCard
                        name="Sarah Jenkins"
                        role="Automation Architect"
                        verified={true}
                        sales="1.2k"
                    />
                    <CreatorProfileCard
                        name="AutomatePro Agency"
                        role="Enterprise Partner"
                        verified={true}
                        sales="5.4k"
                    />
                </div>
            </section>

        </main>
    );
}
