import type { Metadata } from 'next'
import { OrderTracker } from '@/components/orders/order-tracker'
import { BuildGraphPanel } from '@/components/build-graph/BuildGraphPanel'

export const metadata: Metadata = { title: 'Order tracking', robots: { index: false }, referrer: 'no-referrer' }

type Props = { params: Promise<{ orderId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Signed buyer link: /orders/:orderId?t=<token> (`?token=` also accepted). */
export default async function OrderPage({ params, searchParams }: Props) {
    const { orderId } = await params
    const sp = await searchParams
    const token = typeof sp.t === 'string' ? sp.t : typeof sp.token === 'string' ? sp.token : null
    return (
        <>
            <OrderTracker orderId={orderId} token={token} />
            <BuildGraphPanel orderId={orderId} token={token} />
        </>
    )
}
