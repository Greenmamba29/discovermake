import type { Metadata } from 'next'
import { SignInScreen } from '@/components/account/sign-in-screen'
import { safeNextPath } from '@/server/auth/cookies'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

/** /signin?next=/path&mode=create — email code, passkey, Google / Apple (ADR-0009). */
export default async function SignInPage({ searchParams }: Props) {
    const sp = await searchParams
    return <SignInScreen next={safeNextPath(one(sp.next))} mode={one(sp.mode) === 'create' ? 'create' : 'signin'} error={one(sp.error)} />
}
