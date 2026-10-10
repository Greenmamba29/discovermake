import type { Metadata } from 'next'
import { KidExit } from '@/components/kids/kid-exit'
import { KidsNotActive } from '@/components/kids/kid-states'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { title: 'Leave Kids mode' }
export const dynamic = 'force-dynamic'

export default async function KidExitPage() {
    const state = await getPageKidState()
    if (state.kind === 'none') return <KidsNotActive ended={false} />
    return <KidExit />
}
