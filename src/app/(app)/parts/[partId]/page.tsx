import type { Metadata } from 'next'
import { ReplacementNotice } from '@/components/account/replacement-notice'
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
    // `?replacement=1`: Repair from My Builds, a quote for just this part (workflow 09).
    const replacement = sp.replacement === '1'
    return (
        <>
            {replacement && <ReplacementNotice />}
            <PartConfigurator partId={partId} fromQuoteId={from} />
        </>
    )
}
