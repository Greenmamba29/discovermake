import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { KID_TEMPLATES, KidTemplateId } from '@/contracts/text-to-cad'
import { KidDesignFlow } from '@/components/kids/kid-design-flow'
import { KidsNotActive } from '@/components/kids/kid-states'
import { kidHomeView } from '@/server/kids'
import { getPageKidState } from '@/server/kids/page'

export const metadata: Metadata = { title: 'Make it' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ template: string }> }

export default async function KidMakePage({ params }: Props) {
    const parsed = KidTemplateId.safeParse((await params).template)
    if (!parsed.success) notFound()
    const state = await getPageKidState()
    if (state.kind !== 'active') return <KidsNotActive ended={state.kind === 'ended'} />
    const allowed = kidHomeView(state.session).templates.some((t) => t.id === parsed.data)
    if (!allowed) {
        return (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8">
                <h1 className="text-3xl font-extrabold text-ink">{KID_TEMPLATES[parsed.data].title}</h1>
                <p className="text-lg text-ink-muted">Ask a grown-up to turn this one on for you.</p>
                <Link href="/kids" className="flex h-16 items-center justify-center rounded-2xl bg-ink text-xl font-extrabold text-paper">
                    Pick another one
                </Link>
            </div>
        )
    }
    return <KidDesignFlow template={parsed.data} />
}
