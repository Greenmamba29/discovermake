"use client";

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Sparkles, Menu, User, LogOut, Search, Lock } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { useRouter } from "next/navigation"

export function Navbar() {
    const { user, loading, signOut } = useAuth();
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState("");

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            router.push(`/templates?search=${encodeURIComponent(searchQuery)}`);
        }
    };

    return (
        <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-black/80 backdrop-blur-md">
            <div className="container flex h-16 items-center justify-between px-4 md:px-6 max-w-7xl mx-auto">
                {/* Logo & Brand */}
                <Link href="/" className="flex items-center gap-2 mr-6">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
                        <Sparkles className="h-4 w-4" />
                    </div>
                    <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">DiscoverMake</span>
                </Link>

                {/* Desktop Navigation */}
                <nav className="hidden lg:flex items-center gap-6 text-sm font-medium mr-auto">
                    <Link href="/templates" className="text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Directory
                    </Link>
                    <Link href="/pricing" className="text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Pricing
                    </Link>
                    <Link href="/bundles" className="text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Bundles
                    </Link>
                </nav>

                {/* Search & Actions */}
                <div className="flex items-center gap-4">
                    {/* Search Bar - "Path to Success" */}
                    <form onSubmit={handleSearch} className="hidden md:flex relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                        <Input
                            type="search"
                            placeholder="Find automation..."
                            className="pl-9 w-64 bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 focus:w-80 transition-all duration-300 rounded-full text-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {/* Premium Hint (Optional visual cue) */}
                        {(!user) && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <Lock className="w-3 h-3 text-slate-400" />
                            </div>
                        )}
                    </form>

                    {/* Auth Buttons */}
                    {!loading && user ? (
                        <div className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-800">
                            <div className="hidden md:flex flex-col items-end">
                                <span className="text-xs font-bold text-slate-900 dark:text-white leading-none">
                                    {user.displayName || "Maker"}
                                </span>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                                    Pro Member
                                </span>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => signOut()} title="Sign Out" className="hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                                <LogOut className="h-5 w-5" />
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" className="hidden md:flex text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" asChild>
                                <Link href="/login">Log in</Link>
                            </Button>
                            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-blue-500/20 rounded-full px-6" asChild>
                                <Link href="/pricing">Get All Access</Link>
                            </Button>
                        </div>
                    )}

                    <Button variant="ghost" size="icon" className="lg:hidden">
                        <Menu className="h-5 w-5" />
                    </Button>
                </div>
            </div>
        </header>
    )
}
