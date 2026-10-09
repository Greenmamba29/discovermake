import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LEGAL_DOCS, LEGAL_SLUGS, legalEffectiveDate, type LegalSlug } from '@/lib/legal'

type Props = { params: Promise<{ doc: string }> }

const isSlug = (s: string): s is LegalSlug => (LEGAL_SLUGS as readonly string[]).includes(s)

export function generateStaticParams() {
    return LEGAL_SLUGS.map((doc) => ({ doc }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { doc } = await params
    if (!isSlug(doc)) return {}
    return { title: LEGAL_DOCS[doc].title, description: LEGAL_DOCS[doc].summary }
}

export default async function LegalPage({ params }: Props) {
    const { doc } = await params
    if (!isSlug(doc)) notFound()
    const d = LEGAL_DOCS[doc]
    const effective = legalEffectiveDate()
    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
            <nav aria-label="Legal documents" className="mb-6 flex flex-wrap gap-2 text-sm">
                {LEGAL_SLUGS.map((s) => (
                    <Link
                        key={s}
                        href={`/legal/${s}`}
                        aria-current={s === doc ? 'page' : undefined}
                        className={s === doc ? 'rounded-lg bg-ink px-3 py-1.5 font-semibold text-paper' : 'rounded-lg px-3 py-1.5 text-ink-muted hover:bg-black/5 hover:text-ink'}
                    >
                        {LEGAL_DOCS[s].title}
                    </Link>
                ))}
            </nav>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{d.title}</h1>
            <p className="mt-3 text-ink-muted">{d.summary}</p>
            {effective ? (
                <p className="mt-2 text-sm text-ink-muted">Effective {effective}</p>
            ) : (
                <p role="note" data-testid="legal-draft-banner" className="mt-4 rounded-xl border border-amber bg-amber/20 px-4 py-3 text-sm text-ink">
                    Draft for legal review. This document is not yet in effect.
                </p>
            )}
            <div className="mt-8 space-y-8">
                {d.sections.map((s) => (
                    <section key={s.heading} aria-labelledby={`h-${slugify(s.heading)}`}>
                        <h2 id={`h-${slugify(s.heading)}`} className="text-xl font-semibold">
                            {s.heading}
                        </h2>
                        {s.paragraphs.map((p, i) => (
                            <p key={i} className="mt-3 leading-relaxed text-ink">
                                {p}
                            </p>
                        ))}
                        {s.bullets && (
                            <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
                                {s.bullets.map((b, i) => (
                                    <li key={i}>{b}</li>
                                ))}
                            </ul>
                        )}
                    </section>
                ))}
            </div>
        </div>
    )
}

function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
