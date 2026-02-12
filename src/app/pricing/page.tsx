import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import Link from "next/link";

export default function PricingPage() {
    return (
        <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-black">
            <Navbar />
            <main className="flex-1 py-20 px-4">
                <div className="container mx-auto max-w-6xl">
                    <div className="text-center mb-16 space-y-4">
                        <h1 className="text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
                            Time is Money. <span className="text-blue-600">Save Both.</span>
                        </h1>
                        <p className="text-xl text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
                            Stop building from scratch. Access professional automation blueprints that pay for themselves in hours.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        {/* Free Tier */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col">
                            <h2 className="text-2xl font-bold mb-2">Starter</h2>
                            <p className="text-slate-500 mb-6">For automation beginners.</p>
                            <div className="text-4xl font-bold mb-6">$0</div>
                            <Button variant="outline" className="mb-8" asChild>
                                <Link href="/register">Get Started</Link>
                            </Button>
                            <ul className="space-y-4 flex-1">
                                <li className="flex gap-3"><Check className="text-green-500" /> Access to Free Templates</li>
                                <li className="flex gap-3"><Check className="text-green-500" /> Community Support</li>
                                <li className="flex gap-3"><Check className="text-green-500" /> Basic Documentation</li>
                            </ul>
                        </div>

                        {/* Pro Tier (Popular) */}
                        <div className="bg-slate-900 dark:bg-slate-800 text-white rounded-2xl p-8 border-2 border-blue-500 shadow-2xl relative flex flex-col transform md:-translate-y-4">
                            <div className="absolute top-0 right-0 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg rounded-tr-lg">MOST POPULAR</div>
                            <h2 className="text-2xl font-bold mb-2">Professional</h2>
                            <p className="text-slate-400 mb-6">For scaling businesses.</p>
                            <div className="text-4xl font-bold mb-6">$49<span className="text-lg font-normal text-slate-400">/mo</span></div>
                            <Button className="mb-8 bg-blue-600 hover:bg-blue-700 h-12 text-lg" asChild>
                                <Link href="/register?plan=pro">Start Pro Trial</Link>
                            </Button>
                            <ul className="space-y-4 flex-1">
                                <li className="flex gap-3"><Check className="text-blue-400" /> All Premium Templates</li>
                                <li className="flex gap-3"><Check className="text-blue-400" /> Private Support Channel</li>
                                <li className="flex gap-3"><Check className="text-blue-400" /> Request Custom Workflows</li>
                                <li className="flex gap-3"><Check className="text-blue-400" /> Early Access to New Drops</li>
                            </ul>
                        </div>

                        {/* Enterprise Tier */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col">
                            <h2 className="text-2xl font-bold mb-2">Agency</h2>
                            <p className="text-slate-500 mb-6">For automation teams.</p>
                            <div className="text-4xl font-bold mb-6">$199<span className="text-lg font-normal text-slate-500">/mo</span></div>
                            <Button variant="outline" className="mb-8" asChild>
                                <Link href="/contact">Contact Sales</Link>
                            </Button>
                            <ul className="space-y-4 flex-1">
                                <li className="flex gap-3"><Check className="text-green-500" /> 10 Team Seats</li>
                                <li className="flex gap-3"><Check className="text-green-500" /> White-label Rights</li>
                                <li className="flex gap-3"><Check className="text-green-500" /> Dedicated Account Manager</li>
                                <li className="flex gap-3"><Check className="text-green-500" /> API Access</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
