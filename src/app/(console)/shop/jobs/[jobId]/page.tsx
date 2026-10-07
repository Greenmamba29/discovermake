import type { Metadata } from 'next'
import { JobDetail } from '@/components/shop/job-detail'

export const metadata: Metadata = { title: 'Job' }

type Props = { params: Promise<{ jobId: string }> }

export default async function ShopJobPage({ params }: Props) {
    const { jobId } = await params
    return <JobDetail jobId={jobId} />
}
