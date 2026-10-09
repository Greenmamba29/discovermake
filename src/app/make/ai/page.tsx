import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MakeAiIntake } from '@/components/make-ai/make-ai-intake'
import { BottomNav } from '@/components/site/bottom-nav'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { MAKE_AI_MAX_INPUT_CHARS } from '@/contracts/make-ai'
import { env } from '@/server/env'

export const metadata: Metadata = { title: 'Make AI', robots: { index: false } }

/**
 * /make/ai: Make AI intake (spec §7.5, R2 seed). Shown only when
 * NEXT_PUBLIC_MAKE_AI_ENABLED=true; the API it calls has its own server-side flag.
 * Lives at /make/ai because /make is the R1 DXF upload page.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function MakeAiPage({ searchParams }: Props) {
    if (!env().NEXT_PUBLIC_MAKE_AI_ENABLED) notFound()
    // ?prompt= prefills the composer (Home intake, Make-anything tiles, Discover starters). Never auto-submitted.
    const raw = (await searchParams).prompt
    const prompt = typeof raw === 'string' ? raw.slice(0, MAKE_AI_MAX_INPUT_CHARS) : ''
    return (
        <div className="flex min-h-screen flex-col bg-graphite-950 text-fg">
            <SiteHeader />
            <main id="main" className="grid-bg flex flex-1 flex-col">
                <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
                    <p className="eyebrow">Make AI · preview</p>
                    <h1 className="mt-3 font-display font-wide text-3xl font-extrabold tracking-tight sm:text-5xl">Describe it. We plan it.</h1>
                    <p className="mt-4 max-w-xl text-fg-muted">
                        Tell Make AI what you want to make. It drafts the requirements, the questions we need answered and the materials and processes that fit. It is an AI estimate, not a quote.
                    </p>
                    <div className="mt-8">
                        <MakeAiIntake initialText={prompt} />
                    </div>
                </div>
            </main>
            <SiteFooter />
            <BottomNav />
        </div>
    )
}
