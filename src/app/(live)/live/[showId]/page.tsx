import type { Metadata } from 'next'
import { LiveViewer } from '@/components/live/live-viewer'

export const metadata: Metadata = { title: 'Live show' }

type Props = { params: Promise<{ showId: string }> }

export default async function LiveShowPage({ params }: Props) {
    const { showId } = await params
    return <LiveViewer showId={showId} />
}
