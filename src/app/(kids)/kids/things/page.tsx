import type { Metadata } from 'next'
import { KidThings } from '@/components/kids/kid-things'
import { KidsNotActive } from '@/components/kids/kid-states'
import { listKidThings } from '@/server/kids'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { title: 'My things' }
export const dynamic = 'force-dynamic'

/** My things: Waiting for a grown-up / Yes! It's being made / On its way / Here!, from the real order. */
export default async function KidThingsPage() {
    const state = await getPageKidState()
    if (state.kind !== 'active') return <KidsNotActive ended={state.kind === 'ended'} />
    const items = await listKidThings(state.session)
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6">
            <h1 className="text-3xl font-extrabold text-ink">My things</h1>
            <KidThings items={items} />
        </div>
    )
}
