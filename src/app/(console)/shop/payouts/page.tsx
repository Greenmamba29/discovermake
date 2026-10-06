import type { Metadata } from 'next'
import { ShopPayoutsReturnStatus } from '@/contracts/connect'
import { ShopPayoutsView } from '@/components/shop/payouts-card'

export const metadata: Metadata = { title: 'Payouts' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Stripe Connect return_url (?status=return) and refresh_url (?status=refresh) land here. */
export default async function ShopPayoutsPage({ searchParams }: Props) {
    const parsed = ShopPayoutsReturnStatus.safeParse((await searchParams).status)
    return <ShopPayoutsView returnStatus={parsed.success ? parsed.data : null} />
}
