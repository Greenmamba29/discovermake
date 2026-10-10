import type { Metadata } from 'next'
import Link from 'next/link'
import { KidsNotActive } from '@/components/kids/kid-states'
import { kidLiveShows } from '@/server/kids'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { title: 'Watch Live' }
export const dynamic = 'force-dynamic'

/** View-only Live for kids whose grown-up turned it on: no chat, questions, buying or likes. */
export default async function KidLivePage() {
    const state = await getPageKidState()
    if (state.kind !== 'active') return <KidsNotActive ended={state.kind === 'ended'} />
    if (!state.session.kid.liveViewing) {
        return (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8">
                <h1 className="text-3xl font-extrabold text-ink">Watch Live</h1>
                <p className="text-lg text-ink-muted">Ask a grown-up to turn on Live for you.</p>
                <Link href="/kids" className="flex h-16 items-center justify-center rounded-2xl bg-ink text-xl font-extrabold text-paper">
                    Back to Make
                </Link>
            </div>
        )
    }
    const shows = await kidLiveShows()
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6">
            <h1 className="text-3xl font-extrabold text-ink">Watch Live</h1>
            <p className="text-lg text-ink-muted">Watch makers build things. You can watch only: no chat here.</p>
            {shows.length ? (
                <ul className="grid gap-4" data-testid="kid-live-shows">
                    {shows.map((s) => (
                        <li key={s.id}>
                            <Link href={`/kids/live/${s.id}`} className="flex min-h-[64px] flex-col justify-center rounded-3xl bg-paper-raised p-4 ring-2 ring-inset ring-paper-line hover:ring-ink">
                                <span className="text-xl font-extrabold text-ink">{s.title}</span>
                                <span className="text-base text-ink-muted">{s.status === 'LIVE' ? 'Live now' : 'Coming soon'}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="rounded-3xl bg-paper-raised p-6 text-xl font-bold text-ink ring-2 ring-inset ring-paper-line">Nothing live right now. Check back soon!</p>
            )}
        </div>
    )
}
