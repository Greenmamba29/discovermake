import type { Metadata } from 'next'
import { AdminPrime } from '@/components/prime/admin-prime'

export const metadata: Metadata = { title: 'Moderation queue', robots: { index: false } }

/** Ops: rating moderation, hold requests, order chats and B2B invoices (R3). */
export default function AdminPrimePage() {
    return <AdminPrime />
}
