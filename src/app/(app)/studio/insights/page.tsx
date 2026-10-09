import type { Metadata } from 'next'
import { InsightsScreen } from '@/components/media/insights-screen'

export const metadata: Metadata = { title: 'Insights · Creator Studio', robots: { index: false } }

export default function InsightsPage() {
    return <InsightsScreen />
}
