import type { Metadata } from 'next'
import { PassportView } from '@/components/passport/passport-view'

export const metadata: Metadata = {
    title: 'Product Passport',
    description: 'Verified record of how this part was made: material, partner shop, production milestones and inspection results.',
}

type Props = { params: Promise<{ passportId: string }> }

export default async function PassportPage({ params }: Props) {
    const { passportId } = await params
    return <PassportView passportId={passportId} />
}
