import type { Metadata } from 'next'
import { BuildId } from '@/contracts/common'
import { LICENSE_LABELS } from '@/contracts/media'
import { PublicBuild } from '@/components/media/public-build'
import { env } from '@/server/env'
import { loadPublication } from '@/server/media'

type Props = { params: Promise<{ buildId: string }> }

/** Shareable OpenGraph card for PUBLIC builds only (private ones get a neutral title, never indexed). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { buildId } = await params
    const id = BuildId.safeParse(buildId)
    const pub = id.success ? await loadPublication(id.data).catch(() => null) : null
    if (!pub || pub.visibility !== 'public') return { title: 'Build', robots: { index: false } }
    const url = new URL(`/b/${pub.buildId}`, env().APP_URL).toString()
    const description = (pub.description ?? `${LICENSE_LABELS[pub.license]} · ${pub.royaltyPct}% royalty to the creator · Make This, Remix or Buy on DiscoverMake.`).slice(0, 200)
    const image = pub.coverAttachmentId ? new URL(`/api/media/builds/${pub.buildId}/cover`, env().APP_URL).toString() : undefined
    return {
        title: pub.title,
        description,
        alternates: { canonical: url },
        openGraph: { type: 'website', url, title: pub.title, description, siteName: 'DiscoverMake', ...(image ? { images: [{ url: image, alt: pub.title }] } : {}) },
        twitter: { card: image ? 'summary_large_image' : 'summary', title: pub.title, description, ...(image ? { images: [image] } : {}) },
    }
}

export default async function PublicBuildPage({ params }: Props) {
    const { buildId } = await params
    return <PublicBuild buildId={buildId} />
}
