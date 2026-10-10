import type { Metadata } from 'next'
import { DiscoverCatalog } from '@/components/discover/discover-catalog'
import { DiscoverFeed } from '@/components/media/discover-feed'
import { env } from '@/server/env'

export const metadata: Metadata = {
    title: 'Discover',
    description: 'Published builds, live shows and shoppable clips from makers and factories, plus starter designs you can get made today.',
}

/**
 * /discover: the media feed (For you · Live · New · Trending, search) over published builds,
 * clips and shows (workflow 10, Pinterest home feed / Behance), then the starter catalog as
 * "Start from a template".
 */
export default function DiscoverPage() {
    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
            <p className="eyebrow">Discover</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold tracking-tight sm:text-5xl">Watch it made. Make it yours.</h1>
            <p className="mt-3 max-w-2xl text-fg-muted">Builds published by makers and factories, clips from live shows with the product pinned, and what is live right now.</p>
            <div className="mt-6">
                <DiscoverFeed />
            </div>
            <section aria-labelledby="templates-heading" className="mt-14 border-t border-graphite-700 pt-10" data-testid="discover-templates">
                <h2 id="templates-heading" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
                    Start from a template
                </h2>
                <p className="mt-2 max-w-2xl text-fg-muted">
                    Real starter parts. Laser-cut designs get an instant, binding quote from a partner shop; the rest open Make AI with a precise brief for our CNC, print and wood partners.
                </p>
                <div className="mt-6">
                    <DiscoverCatalog makeAiEnabled={env().NEXT_PUBLIC_MAKE_AI_ENABLED} />
                </div>
            </section>
        </div>
    )
}
