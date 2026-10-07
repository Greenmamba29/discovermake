import type { Metadata } from 'next'
import { SourcingJobDetailScreen } from '@/components/sourcing/admin/job-detail'

export const metadata: Metadata = { title: 'Sourcing job', robots: { index: false } }

type Props = { params: Promise<{ jobId: string }> }

export default async function SourcingJobPage({ params }: Props) {
    const { jobId } = await params
    return <SourcingJobDetailScreen jobId={jobId} />
}
