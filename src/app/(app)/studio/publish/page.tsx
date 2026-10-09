import type { Metadata } from 'next'
import { PublishScreen } from '@/components/media/publish-screen'

export const metadata: Metadata = { title: 'Publishing · Creator Studio', robots: { index: false } }

export default function PublishPage() {
    return <PublishScreen />
}
