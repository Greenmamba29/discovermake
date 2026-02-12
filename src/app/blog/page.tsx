import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export default function BlogPage() {
    return (
        <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-black">
            <Navbar />
            <main className="flex-1 py-16 px-4">
                <div className="container mx-auto max-w-6xl">
                    <div className="mb-12">
                        <h1 className="text-4xl font-bold tracking-tight mb-4">Automation Resources</h1>
                        <p className="text-lg text-slate-500">Guides, tutorials, and success stories.</p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <Link key={i} href="#" className="group block">
                                <div className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 hover:shadow-lg transition-all">
                                    <div className="aspect-video bg-slate-200 relative">
                                        {/* Placeholder for blog image */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                                    </div>
                                    <div className="p-6">
                                        <div className="text-blue-600 text-xs font-bold uppercase tracking-wider mb-2">Tutorial</div>
                                        <h3 className="text-xl font-bold mb-2 group-hover:text-blue-600 transition-colors">
                                            How to automate your entire sales pipeline in 30 minutes
                                        </h3>
                                        <p className="text-slate-500 text-sm line-clamp-2">
                                            Learn the exact steps to connect your CRM to your email marketing tool using Make.com.
                                        </p>
                                        <div className="mt-4 flex items-center text-sm font-medium text-slate-900 dark:text-white">
                                            Read Article <ArrowUpRight className="ml-1 w-4 h-4" />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
