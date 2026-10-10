import type { Metadata } from 'next'
import Link from 'next/link'
import { KidsNotActive } from '@/components/kids/kid-states'
import { listKidSafeBuilds } from '@/server/kids'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { title: 'Ideas' }
export const dynamic = 'force-dynamic'

/** Kids Discover: only builds ops marked kid-safe, read-only (no buying, remixing or comments). */
export default async function KidDiscoverPage() {
    const state = await getPageKidState()
    if (state.kind !== 'active') return <KidsNotActive ended={state.kind === 'ended'} />
    if (!state.session.kid.discoverBrowsing) {
        return (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8">
                <h1 className="text-3xl font-extrabold text-ink">Ideas</h1>
                <p className="text-lg text-ink-muted">Ask a grown-up to turn on Ideas for you.</p>
                <Link href="/kids" className="flex h-16 items-center justify-center rounded-2xl bg-ink text-xl font-extrabold text-paper">
                    Back to Make
                </Link>
            </div>
        )
    }
    const builds = await listKidSafeBuilds()
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6">
            <h1 className="text-3xl font-extrabold text-ink">Ideas</h1>
            <p className="text-lg text-ink-muted">Things other makers built. Look for ideas, then make your own!</p>
            {builds.length ? (
                <ul className="grid gap-4" data-testid="kid-ideas">
                    {builds.map((b) => (
                        <li key={b.buildId} className="rounded-3xl bg-paper-raised p-4 ring-2 ring-inset ring-paper-line">
                            <h2 className="text-xl font-extrabold text-ink">{b.title}</h2>
                            {b.description && <p className="mt-1 text-base text-ink-muted">{b.description}</p>}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="rounded-3xl bg-paper-raised p-6 text-xl font-bold text-ink ring-2 ring-inset ring-paper-line" data-testid="kid-ideas-empty">
                    No ideas here yet. Check back soon!
                </p>
            )}
        </div>
    )
}
