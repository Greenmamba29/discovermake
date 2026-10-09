import type { Metadata } from 'next'
import { CartDone } from '@/components/prime/cart-done'

export const metadata: Metadata = { title: 'Your orders', robots: { index: false }, referrer: 'no-referrer' }

type Props = { params: Promise<{ checkoutId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Signed confirmation of one cart checkout: /cart/done/:checkoutId?t=<token>. */
export default async function CartDonePage({ params, searchParams }: Props) {
    const { checkoutId } = await params
    const sp = await searchParams
    return <CartDone checkoutId={checkoutId} token={typeof sp.t === 'string' ? sp.t : null} />
}
