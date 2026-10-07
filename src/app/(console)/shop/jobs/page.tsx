import type { Metadata } from 'next'
import { JobInbox } from '@/components/shop/job-inbox'
import { PayoutsCard } from '@/components/shop/payouts-card'

export const metadata: Metadata = { title: 'Jobs' }

export default function ShopJobsPage() {
    return (
        <>
            <JobInbox />
            <div className="mx-auto w-full max-w-4xl px-4 pb-10 sm:px-6">
                <PayoutsCard />
            </div>
        </>
    )
}
