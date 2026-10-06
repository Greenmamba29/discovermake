import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { RouteScreen } from '@/components/checkout/route-screen'

export const metadata: Metadata = { title: 'Manufacturing route' }

type Props = { params: Promise<{ buildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function BuildRoutePage({ params, searchParams }: Props) {
    const { buildId } = await params
    const sp = await searchParams
    const quote = typeof sp.quote === 'string' ? sp.quote : null
    if (!quote) redirect(`/build/${encodeURIComponent(buildId)}/configure`)
    return <RouteScreen quoteId={quote} />
}
