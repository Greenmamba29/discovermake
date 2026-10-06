import type { Metadata } from 'next'
import { ConsoleHeader } from '@/components/shop/console-header'

export const metadata: Metadata = { title: { default: 'Shop Console', template: '%s · Shop Console' }, robots: { index: false } }

/** Partner Shop Console (graphite, its own header; auth = httpOnly dm_shop_session cookie). */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-graphite-950 text-fg">
            <ConsoleHeader />
            <main id="main" className="flex flex-1 flex-col">
                {children}
            </main>
        </div>
    )
}
