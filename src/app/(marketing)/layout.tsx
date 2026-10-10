import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { BottomNav } from '@/components/site/bottom-nav'

/** Warm-white editorial surface (marketing + public passport). */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="surface-paper flex min-h-screen flex-col bg-paper text-ink">
            <SiteHeader surface="paper" />
            <main id="main" className="flex flex-1 flex-col">
                {children}
            </main>
            <SiteFooter surface="paper" />
            <BottomNav surface="paper" />
        </div>
    )
}
