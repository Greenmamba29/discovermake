import type { Metadata } from 'next'
import Link from 'next/link'
import { KID_AVATAR_EMOJI, type KidAvatar } from '@/contracts/kids'
import { KidNav } from '@/components/kids/kid-nav'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/**
 * Kids mode surface (docs/architecture/kids-family.md): warm paper, big type, the kid nav
 * (Make · My things · Exit) instead of the adult header, footer and 5-tab nav. No third-party
 * scripts or analytics are loaded here.
 */
export default async function KidsLayout({ children }: { children: React.ReactNode }) {
    const state = await getPageKidState()
    const kid = state.kind === 'active' ? state.session.kid : null
    return (
        <div className="surface-paper flex min-h-screen flex-col bg-paper text-ink" data-kids-mode={state.kind}>
            <header className="sticky top-0 z-30 border-b border-paper-line bg-paper-raised/95 backdrop-blur">
                <div className="mx-auto flex h-16 max-w-xl items-center justify-between gap-3 px-4">
                    <Link href="/kids" className="flex min-h-[48px] items-center text-lg font-extrabold text-ink">
                        DiscoverMake <span className="ml-1.5 rounded-full bg-ink px-2 py-0.5 text-sm text-paper">Kids</span>
                    </Link>
                    {kid && (
                        <p className="flex items-center gap-2 text-base font-bold text-ink" data-testid="kid-hello">
                            <span aria-hidden className="text-2xl">
                                {KID_AVATAR_EMOJI[kid.avatar as KidAvatar] ?? '⭐'}
                            </span>
                            Hi, {kid.nickname}
                        </p>
                    )}
                </div>
            </header>
            <main id="main" className="flex flex-1 flex-col">
                {children}
            </main>
            <KidNav />
        </div>
    )
}
