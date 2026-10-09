import { BottomNav } from '@/components/site/bottom-nav'
import { SiteHeader } from '@/components/site/site-header'

/**
 * Live surfaces: graphite. The bottom nav shows on the Live home and hides itself on the
 * full-screen viewer (`bottomNavVisible`), where the stream takes the full height on phones.
 */
export default function LiveLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-graphite-950 text-fg">
            <SiteHeader />
            <main id="main" className="flex flex-1 flex-col">
                {children}
            </main>
            <BottomNav />
        </div>
    )
}
