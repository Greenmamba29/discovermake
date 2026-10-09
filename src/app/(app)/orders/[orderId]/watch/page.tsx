import type { Metadata } from 'next'
import { WatchMyBuild } from '@/components/media/watch-my-build'

export const metadata: Metadata = { title: 'Watch My Build', robots: { index: false }, referrer: 'no-referrer' }

type Props = { params: Promise<{ orderId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Buyer's production stream: signed order link (`?t=`) or the signed-in buyer. */
export default async function WatchPage({ params, searchParams }: Props) {
    const { orderId } = await params
    const sp = await searchParams
    const token = typeof sp.t === 'string' ? sp.t : typeof sp.token === 'string' ? sp.token : null
    return <WatchMyBuild orderId={orderId} token={token} />
}
