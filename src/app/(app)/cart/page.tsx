import type { Metadata } from 'next'
import { CartScreen } from '@/components/prime/cart-screen'

export const metadata: Metadata = { title: 'Build cart', robots: { index: false } }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Build cart (DoorDash cart + "Complete your build" upsells): several parts, one checkout. */
export default async function CartPage({ searchParams }: Props) {
    const sp = await searchParams
    return <CartScreen cancelled={Boolean(sp.cancelled)} />
}
