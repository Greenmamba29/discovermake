import type { Metadata } from 'next'
import { ClipPlayer } from '@/components/media/clip-player'

export const metadata: Metadata = { title: 'Clip', description: 'A shoppable moment from a DiscoverMake live show: the product is pinned on screen.' }

type Props = { params: Promise<{ clipId: string }> }

export default async function ClipPage({ params }: Props) {
    const { clipId } = await params
    return <ClipPlayer clipId={clipId} />
}
