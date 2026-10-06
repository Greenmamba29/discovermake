import { BuildRedirect } from '@/components/build/build-redirect'

type Props = { params: Promise<{ buildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function BuildConfigurePage({ params, searchParams }: Props) {
    const { buildId } = await params
    const sp = await searchParams
    return <BuildRedirect buildId={buildId} quoteId={typeof sp.from === 'string' ? sp.from : null} />
}
