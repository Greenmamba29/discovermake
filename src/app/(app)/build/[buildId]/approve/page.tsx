import { redirect } from 'next/navigation'
import { BuildRedirect } from '@/components/build/build-redirect'

type Props = { params: Promise<{ buildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Spec route for Screen 04 (also Stripe's cancel_url): the checkout lives at /checkout/:quoteId. */
export default async function BuildApprovePage({ params, searchParams }: Props) {
    const { buildId } = await params
    const sp = await searchParams
    const quote = typeof sp.quote === 'string' ? sp.quote : null
    if (quote && /^qte_[A-Za-z0-9_-]+$/.test(quote)) {
        redirect(`/checkout/${quote}${sp.cancelled ? '?cancelled=1' : ''}`)
    }
    return <BuildRedirect buildId={buildId} quoteId={null} />
}
