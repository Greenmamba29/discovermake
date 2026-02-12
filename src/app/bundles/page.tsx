import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { Package, ArrowRight } from "lucide-react";

const BUNDLES = [
    {
        id: 1,
        title: "The Agency Start-Kit",
        description: "Everything you need to run an automated marketing agency. Includes 10 core workflows.",
        price: "$199",
        originalPrice: "$450",
        image: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&q=80&w=1632",
        features: ["Client Onboarding", "Invoicing System", "Social Media Scheduler", "Lead Enrichment"]
    },
    {
        id: 2,
        title: "E-Commerce Titan",
        description: "Scale your Shopify store on autopilot. Customer support, inventory, and marketing automation.",
        price: "$299",
        originalPrice: "$600",
        image: "https://images.unsplash.com/photo-1556742049-0cfed4f7a07d?auto=format&fit=crop&q=80&w=1770",
        features: ["Cart Recovery", "Order Sync", "Review Requests", "Support Ticket Routing"]
    },
    {
        id: 3,
        title: "Content Machine",
        description: "Turn one piece of content into 50. The ultimate repurposing workflow suite.",
        price: "$149",
        originalPrice: "$300",
        image: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&q=80&w=1770",
        features: ["YouTube to Blog", "Audio to Social", "Newsletter Gen", "Auto-Posting"]
    }
];

export default function BundlesPage() {
    return (
        <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-black">
            <Navbar />
            <main className="flex-1 py-16 px-4">
                <div className="container mx-auto max-w-6xl">
                    <div className="mb-12">
                        <h1 className="text-4xl font-bold tracking-tight mb-4">Power Bundles</h1>
                        <p className="text-lg text-slate-500">Get complete systems for a fraction of the cost.</p>
                    </div>

                    <div className="grid gap-8">
                        {BUNDLES.map((bundle) => (
                            <div key={bundle.id} className="bg-white dark:bg-slate-900 rounded-2xl p-6 md:p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-8 items-center">
                                <div className="w-full md:w-1/3 aspect-video bg-slate-100 rounded-xl overflow-hidden relative">
                                    <Image
                                        src={bundle.image}
                                        alt={bundle.title}
                                        fill
                                        className="object-cover"
                                    />
                                    <div className="absolute top-4 left-4 bg-black/70 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2">
                                        <Package className="w-3 h-3" /> BUNDLE
                                    </div>
                                </div>
                                <div className="flex-1 space-y-4">
                                    <h2 className="text-2xl font-bold">{bundle.title}</h2>
                                    <p className="text-slate-500 dark:text-slate-400">{bundle.description}</p>
                                    <div className="flex flex-wrap gap-2">
                                        {bundle.features.map(f => (
                                            <span key={f} className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full text-xs font-medium">
                                                {f}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="w-full md:w-auto flex flex-col items-center md:items-end gap-4 min-w-[150px]">
                                    <div className="text-right">
                                        <div className="text-sm text-slate-400 line-through">{bundle.originalPrice}</div>
                                        <div className="text-3xl font-bold text-blue-600">{bundle.price}</div>
                                    </div>
                                    <Button size="lg" className="w-full" asChild>
                                        <Link href="/checkout?type=bundle">
                                            Buy Bundle <ArrowRight className="ml-2 w-4 h-4" />
                                        </Link>
                                    </Button>
                                    <div className="text-xs text-green-600 font-bold">Save 50% Today</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
