import type { Metadata } from 'next'
import { ChannelScreen } from '@/components/media/channel-page'
import { channelByHandle } from '@/server/live'

type Props = { params: Promise<{ handle: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { handle } = await params
    const channel = /^[a-z0-9_]{3,24}$/i.test(handle) ? await channelByHandle(handle).catch(() => null) : null
    if (!channel) return { title: 'Channel' }
    return { title: `${channel.name} (@${channel.handle})`, description: channel.bio ?? `Live shows, builds and clips from ${channel.name} on DiscoverMake.`, openGraph: { title: channel.name, description: channel.bio ?? undefined } }
}

export default async function ChannelPage({ params }: Props) {
    const { handle } = await params
    return <ChannelScreen handle={handle.toLowerCase()} />
}
