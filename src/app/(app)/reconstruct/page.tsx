import type { Metadata } from 'next'
import { CaptureScreen } from '@/components/reconstruct/capture-screen'
import { passportPrefill } from '@/server/reconstruct/sessions'

export const metadata: Metadata = { title: 'Reconstruct a broken part', robots: { index: false } }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * /reconstruct: R6 capture (photos of the broken part, what it is, a note). `?passport=<id>`
 * links the replacement to a Product Passport and prefills material and process from its
 * public snapshot ("Replacing part from order ...").
 */
export default async function ReconstructPage({ searchParams }: Props) {
    const { passport } = await searchParams
    const id = typeof passport === 'string' && /^pps_[A-Za-z0-9_-]{1,60}$/.test(passport) ? passport : null
    const prefill = id ? await passportPrefill(id).catch(() => null) : null
    return <CaptureScreen prefill={prefill} />
}
