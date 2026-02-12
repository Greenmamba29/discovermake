import Link from "next/link"
import { Sparkles } from "lucide-react"

export function Footer() {
    return (
        <footer className="w-full bg-slate-50 dark:bg-slate-950 border-t py-12 md:py-24">
            <div className="container px-4 md:px-6 grid gap-8 lg:grid-cols-4">
                <div className="space-y-4">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <span className="text-xl font-bold tracking-tight">DiscoverMake</span>
                    </Link>
                    <p className="text-sm text-muted-foreground max-w-xs">
                        The premium marketplace for AI-powered Make.com automation templates. Save time and scale your business.
                    </p>
                </div>
                <div className="grid gap-2">
                    <h3 className="font-semibold">Platform</h3>
                    <Link href="/templates" className="text-sm text-muted-foreground hover:text-primary">Browse Templates</Link>
                    <Link href="/bundles" className="text-sm text-muted-foreground hover:text-primary">Bundles</Link>
                    <Link href="/pricing" className="text-sm text-muted-foreground hover:text-primary">Pricing</Link>
                </div>
                <div className="grid gap-2">
                    <h3 className="font-semibold">Company</h3>
                    <Link href="/about" className="text-sm text-muted-foreground hover:text-primary">About Us</Link>
                    <Link href="/affiliate" className="text-sm text-muted-foreground hover:text-primary">Become an Affiliate</Link>
                    <Link href="/contact" className="text-sm text-muted-foreground hover:text-primary">Contact Support</Link>
                </div>
                <div className="grid gap-2">
                    <h3 className="font-semibold">Legal</h3>
                    <Link href="/terms" className="text-sm text-muted-foreground hover:text-primary">Terms of Service</Link>
                    <Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary">Privacy Policy</Link>
                    <Link href="/licenses" className="text-sm text-muted-foreground hover:text-primary">License Agreement</Link>
                </div>
            </div>
            <div className="container px-4 md:px-6 mt-12 pt-8 border-t text-center text-sm text-muted-foreground">
                © 2025 DiscoverMake. All rights reserved.
            </div>
        </footer>
    )
}
