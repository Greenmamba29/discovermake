import { getTemplateBySlug, getAllTemplates } from "@/lib/templates";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
    Zap,
    ShieldCheck,
    Clock,
    Share2,
    ArrowLeft,
    Download,
    Bot,
    Code2,
    Layout,
    GitBranch,
    BarChart3,
    ArrowRight
} from "lucide-react";
import { GlassPanel, IronButton, RetroStrata } from "@/components/ui/DesignSystem";
import { ReviewSection } from "@/components/review-section";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";

interface Props {
    params: Promise<{ slug: string }>;
}

export default async function TemplateDetailPage({ params }: Props) {
    const { slug } = await params;
    const template = await getTemplateBySlug(slug);

    if (!template) {
        return notFound();
    }

    // Fetch related templates
    const { templates: related } = await getAllTemplates(1, 4, undefined, template.category);

    return (
        <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
            {/* Background */}
            <div className="fixed inset-0 opacity-10 pointer-events-none origin-center scale-125">
                <HeroMotionBackground />
            </div>

            {/* Navigation Bar */}
            <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-6 pointer-events-none">
                <Link href="/marketplace" className="pointer-events-auto">
                    <button className="size-12 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </Link>
                <div className="flex gap-4">
                    <button className="pointer-events-auto size-12 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all">
                        <Share2 className="w-5 h-5" />
                    </button>
                </div>
            </nav>

            <main className="max-w-4xl mx-auto pt-32 pb-32 px-6 relative z-10 space-y-12">

                {/* Hero Section */}
                <section className="space-y-8">
                    <div className="relative aspect-[16/9] rounded-[2.5rem] overflow-hidden border border-white/10 group shadow-2xl">
                        <Image
                            src={template.coverImage || "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2000"}
                            alt={template.name}
                            fill
                            className="object-cover opacity-60 group-hover:scale-105 transition-transform duration-[10000ms]"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] via-transparent to-transparent" />

                        <div className="absolute bottom-8 left-8 right-8 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="size-14 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                                    <Zap className="w-8 h-8 text-white fill-current" />
                                </div>
                                <div>
                                    <RetroStrata label="Verified Blueprint" variant="success" pulse />
                                    <h1 className="text-3xl font-black tracking-tight uppercase italic text-white mt-1">
                                        {template.name}
                                    </h1>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 italic mb-1">Price</p>
                                <p className="text-3xl font-black text-white italic tracking-tighter">
                                    {template.price === 0 ? "FREE" : `$${template.price}`}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <GlassPanel variant="subtle" className="p-4 rounded-3xl border-white/5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 italic mb-1">Category</p>
                            <p className="text-sm font-bold text-white">{template.category}</p>
                        </GlassPanel>
                        <GlassPanel variant="subtle" className="p-4 rounded-3xl border-white/5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 italic mb-1">Complexity</p>
                            <p className="text-sm font-bold text-white">{template.complexity}</p>
                        </GlassPanel>
                        <GlassPanel variant="subtle" className="p-4 rounded-3xl border-white/5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 italic mb-1">Avg. Outcome</p>
                            <div className="flex items-center gap-1.5 font-bold text-sm text-emerald-400">
                                <BarChart3 className="w-4 h-4" />
                                {template.revenuePotential ? `+$${template.revenuePotential}/mo` : "High"}
                            </div>
                        </GlassPanel>
                        <GlassPanel variant="subtle" className="p-4 rounded-3xl border-white/5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 italic mb-1">Time Saved</p>
                            <div className="flex items-center gap-1.5 font-bold text-sm text-blue-400">
                                <Clock className="w-4 h-4" />
                                {template.monthlyHoursSaved || 10}h / mo
                            </div>
                        </GlassPanel>
                    </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                    {/* Left Column: Details */}
                    <div className="md:col-span-2 space-y-12">
                        <section className="space-y-4">
                            <h2 className="text-xl font-black tracking-tight uppercase italic flex items-center gap-3">
                                <Bot className="w-6 h-6 text-blue-500" />
                                Blueprint Intelligence
                            </h2>
                            <p className="text-gray-400 leading-relaxed italic text-lg">
                                {template.shortDescription}
                            </p>
                        </section>

                        <section className="space-y-6">
                            <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.3em] italic">Infrastructure Stack</h3>
                            <div className="flex flex-wrap gap-3">
                                {template.requiredServices.map((service) => (
                                    <div key={service} className="px-5 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-xs font-bold text-white uppercase italic tracking-widest flex items-center gap-2">
                                        <div className="size-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                        {service}
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="space-y-6">
                            <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.3em] italic">Included Assets</h3>
                            <div className="grid grid-cols-1 gap-4">
                                <div className="flex items-center gap-4 p-5 rounded-3xl bg-white/5 border border-white/10 group hover:border-blue-500/30 transition-all">
                                    <div className="size-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                                        <Code2 className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-white text-sm">Source Blueprint</p>
                                        <p className="text-[10px] font-black uppercase italic text-gray-500 tracking-widest mt-0.5">Full .JSON logic flow</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 p-5 rounded-3xl bg-white/5 border border-white/10 group hover:border-purple-500/30 transition-all">
                                    <div className="size-12 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                                        <Layout className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-white text-sm">Admin UI Mockups</p>
                                        <p className="text-[10px] font-black uppercase italic text-gray-500 tracking-widest mt-0.5">Vite + Tailwind Templates</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 p-5 rounded-3xl bg-white/5 border border-white/10 group hover:border-emerald-500/30 transition-all">
                                    <div className="size-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                                        <GitBranch className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-white text-sm">Deployment Guide</p>
                                        <p className="text-[10px] font-black uppercase italic text-gray-500 tracking-widest mt-0.5">Step-by-step handoff docs</p>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="pt-8">
                            <ReviewSection templateId={template.id} />
                        </section>
                    </div>

                    {/* Right Column: Actions & Creator */}
                    <div className="space-y-8">
                        <GlassPanel variant="glow" className="p-8 rounded-[2rem] border-white/10 space-y-6 sticky top-32">
                            <div>
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-500 italic mb-4">Deployment Options</h4>
                                <div className="space-y-4">
                                    <button className="w-full h-16 rounded-2xl bg-blue-600 text-white font-black uppercase italic tracking-widest text-[11px] shadow-lg shadow-blue-500/30 hover:bg-blue-500 transition-all flex items-center justify-center gap-3 active:scale-95">
                                        <Download className="w-5 h-5" />
                                        Remix Blueprint
                                    </button>
                                    <button className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase italic tracking-widest text-[10px] hover:bg-white/10 transition-all active:scale-95">
                                        Save to Vault
                                    </button>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-white/10">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-500 italic mb-4">Developed By</h4>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="relative size-12 rounded-2xl overflow-hidden border border-white/10">
                                        <Image src={`https://i.pravatar.cc/100?u=${template.id}`} alt="Creator" fill className="object-cover" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <p className="font-bold text-white text-sm">Nano Labs</p>
                                            <ShieldCheck className="w-3.5 h-3.5 text-blue-500 fill-blue-500/10" />
                                        </div>
                                        <p className="text-[9px] font-black uppercase italic text-gray-500">Top 1% Creator</p>
                                    </div>
                                </div>
                                <IronButton variant="secondary" size="sm" className="w-full h-10 text-[10px] uppercase italic tracking-[0.15em]">
                                    View Foundry
                                </IronButton>
                            </div>
                        </GlassPanel>
                    </div>
                </div>

                {/* Related Workflows */}
                <section className="pt-20 border-t border-white/5">
                    <div className="flex items-center justify-between mb-8">
                        <h2 className="text-2xl font-black tracking-tight uppercase italic">Similar Blueprints</h2>
                        <Link href="/marketplace" className="text-[10px] font-black uppercase text-blue-500 italic tracking-widest hover:underline">View All</Link>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {related.filter(r => r.id !== template.id).slice(0, 4).map((item) => (
                            <Link key={item.id} href={`/templates/${item.slug}`}>
                                <GlassPanel variant="subtle" className="p-4 rounded-[1.5rem] border-white/5 group hover:border-white/20 transition-all">
                                    <div className="relative aspect-video rounded-xl overflow-hidden mb-4">
                                        <Image src={item.coverImage} alt={item.name} fill className="object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                                    </div>
                                    <h4 className="font-bold text-white text-xs truncate group-hover:text-blue-400 transition-colors uppercase italic">{item.name}</h4>
                                </GlassPanel>
                            </Link>
                        ))}
                    </div>
                </section>
            </main>

            {/* Floating Contact/Service Expansion */}
            <div className="fixed bottom-10 left-10 z-40">
                <button className="flex items-center gap-3 bg-white/5 backdrop-blur-3xl border border-white/10 pl-3 pr-6 py-2 rounded-full hover:bg-white/10 transition-all shadow-2xl">
                    <div className="size-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                        <Bot className="size-4 text-white" />
                    </div>
                    <div className="text-left leading-none">
                        <p className="text-[9px] font-black uppercase text-emerald-400 italic">Customization?</p>
                        <p className="text-[10px] font-bold text-white mt-0.5">Talk to the Maker</p>
                    </div>
                </button>
            </div>
        </div>
    );
}
