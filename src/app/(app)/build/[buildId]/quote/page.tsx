import { BuildRedirect } from '@/components/build/build-redirect'

type Props = { params: Promise<{ buildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function BuildQuotePage({ params, searchParams }: Props) {
    const { buildId } = await params
    const sp = await searchParams
    return <BuildRedirect buildId={buildId} quoteId={typeof sp.quote === 'string' ? sp.quote : null} />
}
