import type { Metadata } from 'next'
import { PrimeFamilyCard } from '@/components/prime/prime-family-card'
import { PrimePaywall } from '@/components/prime/prime-paywall'
import { getPageViewer } from '@/server/auth/page'
import { getMembershipResponse } from '@/server/prime/membership'

export const metadata: Metadata = { title: 'Prime', description: 'Free shipping, priority shop slots, guaranteed dates and member material pricing. Try it free for 7 days.' }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Prime paywall (Copilot "Claim your free trial" / Givingli trial timeline). */
export default async function PrimePage({ searchParams }: Props) {
    const sp = await searchParams
    const viewer = await getPageViewer()
    const data = await getMembershipResponse(viewer ? { id: viewer.user.id, email: viewer.user.email } : null)
    return (
        <>
            <PrimePaywall initial={data} cancelled={Boolean(sp.cancelled)} />
            <PrimeFamilyCard />
        </>
    )
}
