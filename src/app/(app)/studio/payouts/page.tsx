import type { Metadata } from 'next'
import { PayoutsScreen } from '@/components/media/payouts-screen'

export const metadata: Metadata = { title: 'Payouts · Creator Studio', robots: { index: false } }

export default function PayoutsPage() {
    return <PayoutsScreen />
}
