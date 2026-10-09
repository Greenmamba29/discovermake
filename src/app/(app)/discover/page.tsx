import type { Metadata } from 'next'
import { DiscoverCatalog } from '@/components/discover/discover-catalog'
import { env } from '@/server/env'

export const metadata: Metadata = {
    title: 'Discover',
    description: 'Starter designs you can get made today: instant laser-cut quotes, or a Make AI plan for CNC, 3D printing and wood.',
}

/** /discover: the starter catalog (workflow 10, Pinterest / Behance grid), filtered by interest. */
export default function DiscoverPage() {
    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
            <p className="eyebrow">Discover</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold tracking-tight sm:text-5xl">Start from a design</h1>
            <p className="mt-3 max-w-2xl text-fg-muted">
                Real starter parts. Laser-cut designs get an instant, binding quote from a partner shop; the rest open Make AI with a precise brief for our CNC, print and wood partners.
            </p>
            <div className="mt-6">
                <DiscoverCatalog makeAiEnabled={env().NEXT_PUBLIC_MAKE_AI_ENABLED} />
            </div>
        </div>
    )
}
