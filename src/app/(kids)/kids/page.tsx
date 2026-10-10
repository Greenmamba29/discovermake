import type { Metadata } from 'next'
import Link from 'next/link'
import { KidPreview } from '@/components/kids/kid-preview'
import { KidsNotActive } from '@/components/kids/kid-states'
import { kidHomeView } from '@/server/kids'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { title: 'Kids mode' }
export const dynamic = 'force-dynamic'

const TILE_COLORS = ['blue', 'orange', 'green', 'purple', 'red'] as const

/** Kid home: big picture tiles for the projects the grown-up allowed. One tap starts one. */
export default async function KidsHomePage() {
    const state = await getPageKidState()
    if (state.kind !== 'active') return <KidsNotActive ended={state.kind === 'ended'} />
    const home = kidHomeView(state.session)
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6">
            <h1 className="text-3xl font-extrabold leading-tight text-ink">What do you want to make?</h1>
            <p className="text-lg text-ink-muted">Pick one. You choose the words and the color.</p>
            {home.templates.length ? (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="kid-tiles">
                    {home.templates.map((t, i) => (
                        <li key={t.id}>
                            <Link href={`/kids/make/${t.id}`} className="flex h-full min-h-[48px] flex-col gap-2 rounded-3xl bg-paper-raised p-4 ring-2 ring-inset ring-paper-line hover:ring-ink" data-testid={`kid-tile-${t.id}`}>
                                <KidPreview template={t.id} options={{ color: TILE_COLORS[i % TILE_COLORS.length], label: t.id === 'name_keychain' || t.id === 'bookmark' ? 'HELLO' : undefined, cups: 3 }} title={`Picture of a ${t.title.toLowerCase()}`} />
                                <span className="text-2xl font-extrabold text-ink">{t.title}</span>
                                <span className="text-base text-ink-muted">{t.blurb}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="rounded-3xl bg-paper-raised p-6 text-xl font-bold text-ink ring-2 ring-inset ring-paper-line">Ask a grown-up to turn on a project for you.</p>
            )}
            {(home.canDiscover || home.canWatchLive) && (
                <div className="grid grid-cols-2 gap-4">
                    {home.canDiscover && (
                        <Link href="/kids/discover" className="flex min-h-[64px] items-center justify-center rounded-3xl bg-paper-raised text-xl font-extrabold text-ink ring-2 ring-inset ring-paper-line" data-testid="kid-tile-discover">
                            Ideas
                        </Link>
                    )}
                    {home.canWatchLive && (
                        <Link href="/kids/live" className="flex min-h-[64px] items-center justify-center rounded-3xl bg-paper-raised text-xl font-extrabold text-ink ring-2 ring-inset ring-paper-line" data-testid="kid-tile-live">
                            Watch Live
                        </Link>
                    )}
                </div>
            )}
        </div>
    )
}
