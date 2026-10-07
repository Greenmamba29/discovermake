import type { Metadata } from 'next'
import { PartConfigurator } from '@/components/configure/part-configurator'

export const metadata: Metadata = { title: 'Configure your part' }

type Props = {
    params: Promise<{ partId: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PartPage({ params, searchParams }: Props) {
    const { partId } = await params
    const sp = await searchParams
    const from = typeof sp.from === 'string' ? sp.from : null
    return <PartConfigurator partId={partId} fromQuoteId={from} />
}
