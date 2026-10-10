import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ReconstructFlow } from '@/components/reconstruct/reconstruct-flow'

export const metadata: Metadata = { title: 'Reconstruct', robots: { index: false } }

type Props = { params: Promise<{ buildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * /reconstruct/:buildId?step=measure|confirm|review: measure on the photo, confirm every
 * critical size with a caliper, then review the generated part and its binding print quote.
 * Anyone with the unguessable id can view; only the owner can change it (the API enforces it).
 */
export default async function ReconstructBuildPage({ params, searchParams }: Props) {
    const { buildId } = await params
    if (!/^bld_[A-Za-z0-9_-]{1,60}$/.test(buildId)) notFound()
    const { step } = await searchParams
    return <ReconstructFlow buildId={buildId} step={typeof step === 'string' ? step : null} />
}
