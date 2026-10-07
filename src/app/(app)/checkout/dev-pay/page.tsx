import type { Metadata } from 'next'
import { DevPaymentPanel } from '@/components/checkout/dev-payment-panel'
import { ErrorState } from '@/components/ui/state'
import { ButtonLink } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Test payment', robots: { index: false } }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Redirect target of the dev payment provider (`/checkout/dev-pay?ref=<providerRef>`). The API refuses it in production. */
export default async function DevPayPage({ searchParams }: Props) {
    const sp = await searchParams
    const ref = typeof sp.ref === 'string' ? sp.ref : null
    if (!ref) {
        return <ErrorState title="Missing payment reference" message="This test payment link is incomplete. Start checkout again from your quote." action={<ButtonLink href="/make">Upload a part</ButtonLink>} />
    }
    return (
        <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
            <p className="eyebrow">Payment</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">Confirm your payment</h1>
            <div className="mt-6">
                <DevPaymentPanel providerRef={ref} />
            </div>
        </div>
    )
}
