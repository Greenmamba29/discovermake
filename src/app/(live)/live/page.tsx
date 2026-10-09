import type { Metadata } from 'next'
import { LiveHome } from '@/components/live/live-home'

export const metadata: Metadata = { title: 'Live', description: 'Watch things being made, ask the maker, and claim a Build Slot in the production run.' }

export default function LivePage() {
    return <LiveHome />
}
