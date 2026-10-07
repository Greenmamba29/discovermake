import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'

/** Graphite app surface (make, configure, checkout, tracking, shop console). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-graphite-950 text-fg">
            <SiteHeader />
            <main id="main" className="flex flex-1 flex-col">
                {children}
            </main>
            <SiteFooter />
        </div>
    )
}
