import type { Metadata } from 'next'
import Link from 'next/link'
import { KidLiveViewer } from '@/components/kids/kid-live-viewer'
import { KidsNotActive } from '@/components/kids/kid-states'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { title: 'Watch Live' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ showId: string }> }

export default async function KidLiveShowPage({ params }: Props) {
    const { showId } = await params
    const state = await getPageKidState()
    if (state.kind !== 'active') return <KidsNotActive ended={state.kind === 'ended'} />
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
            <h1 className="text-3xl font-extrabold text-ink">Watch Live</h1>
            {state.session.kid.liveViewing ? <KidLiveViewer showId={showId} /> : <p className="text-lg text-ink-muted">Ask a grown-up to turn on Live for you.</p>}
            <Link href="/kids/live" className="flex h-14 items-center justify-center rounded-2xl bg-paper-raised text-lg font-extrabold text-ink ring-2 ring-inset ring-paper-line">
                Back
            </Link>
        </div>
    )
}
