import type { Metadata } from 'next'
import { CheckoutForm } from '@/components/checkout/checkout-form'

export const metadata: Metadata = { title: 'Checkout' }

type Props = { params: Promise<{ quoteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function CheckoutPage({ params, searchParams }: Props) {
    const { quoteId } = await params
    const sp = await searchParams
    return <CheckoutForm quoteId={quoteId} cancelled={Boolean(sp.cancelled)} />
}
