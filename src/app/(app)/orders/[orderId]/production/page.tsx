import type { Metadata } from 'next'
import { ProductionRun } from '@/components/orders/production-run'

export const metadata: Metadata = { title: 'Production run', robots: { index: false }, referrer: 'no-referrer' }

type Props = { params: Promise<{ orderId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ProductionPage({ params, searchParams }: Props) {
    const { orderId } = await params
    const sp = await searchParams
    const token = typeof sp.t === 'string' ? sp.t : typeof sp.token === 'string' ? sp.token : null
    return <ProductionRun orderId={orderId} token={token} />
}
