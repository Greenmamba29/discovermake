import type { Metadata } from 'next'
import { FamilyScreen } from '@/components/family/family-screen'
import { ButtonLink } from '@/components/ui/button'
import { getPageViewer } from '@/server/auth/page'
import { getFamilyView } from '@/server/kids'

export const metadata: Metadata = { title: 'Family', robots: { index: false } }
export const dynamic = 'force-dynamic'

/** Family setup for grown-ups (Amazon household style): kid profiles, controls, PIN, requests inbox. */
export default async function FamilyPage() {
    const viewer = await getPageViewer()
    if (!viewer) {
        return (
            <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
                <h1 className="text-3xl font-bold text-fg">Family</h1>
                <section className="mt-6 rounded-2xl bg-graphite-900 p-6 ring-1 ring-graphite-700" data-testid="family-signed-out">
                    <p className="text-fg-muted">Sign in as the grown-up to add kid profiles, start Kids mode on this device and approve what your kids ask for. Kids never need an account or an email.</p>
                    <ButtonLink href="/signin?next=/family" size="lg" className="mt-4" data-testid="family-signin">
                        Sign in
                    </ButtonLink>
                </section>
            </div>
        )
    }
    return <FamilyScreen initial={await getFamilyView(viewer.user.id)} />
}
