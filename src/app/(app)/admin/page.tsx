import type { Metadata } from 'next'
import { OpsBoard } from '@/components/admin/ops-board'

export const metadata: Metadata = { title: 'Ops board', robots: { index: false } }

export default function AdminPage() {
    return <OpsBoard />
}
