import type { Metadata } from 'next'
import { ControlRoom } from '@/components/studio/control-room'

export const metadata: Metadata = { title: 'Control room' }

type Props = { params: Promise<{ showId: string }> }

export default async function ControlRoomPage({ params }: Props) {
    const { showId } = await params
    return <ControlRoom showId={showId} />
}
