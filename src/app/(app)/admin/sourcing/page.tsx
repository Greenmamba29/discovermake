import type { Metadata } from 'next'
import { SourcingDesk } from '@/components/sourcing/admin/sourcing-desk'

export const metadata: Metadata = { title: 'Sourcing desk', robots: { index: false } }

export default function SourcingDeskPage() {
    return <SourcingDesk />
}
