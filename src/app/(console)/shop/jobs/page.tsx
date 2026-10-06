import type { Metadata } from 'next'
import { JobInbox } from '@/components/shop/job-inbox'

export const metadata: Metadata = { title: 'Jobs' }

export default function ShopJobsPage() {
    return <JobInbox />
}
