import type { Metadata } from 'next'
import { MeScreen } from '@/components/account/me-screen'

export const metadata: Metadata = { title: 'Your account', robots: { index: false } }

export default function MePage() {
    return <MeScreen />
}
