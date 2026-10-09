import type { Metadata } from 'next'
import { MembershipScreen } from '@/components/prime/membership-screen'

export const metadata: Metadata = { title: 'Membership', robots: { index: false } }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Manage Prime: status, renewal date, cancel / resume. */
export default async function MembershipPage({ searchParams }: Props) {
    const sp = await searchParams
    return <MembershipScreen welcome={Boolean(sp.welcome)} />
}
