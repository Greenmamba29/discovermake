import Link from 'next/link'
import { ArrowRight, BadgeCheck, FileCheck2, PackageCheck, ScanLine, ShieldCheck, Truck, UploadCloud, Wrench } from 'lucide-react'
import { PartUploader } from '@/components/upload/part-uploader'
import { MaterialsStrip } from '@/components/marketing/materials-strip'
import { HeroPart } from '@/components/marketing/hero-part'

const TILES = [
    { title: 'Laser cut', body: 'Aluminum, steel, stainless and brass, 22 ga to 1/4" thick.', available: true },
    { title: 'Bend', body: 'Press-brake bending from the BEND layer in your DXF.', available: true },
    { title: 'Wood', body: 'Baltic birch plywood and walnut, CO₂ laser cut.', available: true },
    { title: 'Acrylic', body: 'Black cast acrylic, 3 to 6 mm, laser-polished edges.', available: true },
    { title: 'STEP · CNC', body: 'Machined parts from STEP files.', available: false },
    { title: '3D print', body: 'Printed parts from STL and 3MF.', available: false },
] as const

const STEPS = [
    { icon: UploadCloud, title: 'Upload your DXF', body: 'We read the geometry in seconds: size, cut length, holes and bend lines.' },
    { icon: Wrench, title: 'Configure and get a binding quote', body: 'Pick material, thickness and finish. Manufacturability checks run as you choose, and the price you see is the price you pay.' },
    { icon: ScanLine, title: 'A partner shop makes it', body: 'Your order goes to a vetted shop. Every part is inspected against your drawing before it ships.' },
    { icon: PackageCheck, title: 'Delivered with a passport', body: 'Track every milestone live. On delivery your parts get a signed Product Passport anyone can verify.' },
] as const

const TRUST = [
    { icon: FileCheck2, title: 'Binding quotes', body: 'No “final price after review” for catalog parts.' },
    { icon: ShieldCheck, title: 'QA before shipping', body: 'Nothing ships until inspection passes.' },
    { icon: BadgeCheck, title: 'Signed Product Passport', body: 'Material, shop, milestones and measurements.' },
    { icon: Truck, title: 'Tracked to your door', body: 'Live production updates and carrier tracking.' },
] as const

export default function HomePage() {
    return (
        <>
            <section className="relative overflow-hidden border-b border-paper-line">
                <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 md:grid-cols-[1.15fr_1fr] md:pb-20 md:pt-16">
                    <div>
                        <p className="eyebrow">Discover. Make. Build.</p>
                        <h1 className="mt-4 font-display font-wide text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-ink sm:text-6xl">
                            What do you want to make?
                        </h1>
                        <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-muted">
                            Upload a flat-pattern DXF. Get an instant, binding quote. A vetted partner shop cuts, bends, finishes and inspects your parts, then ships them to your door.
                        </p>
                        <div className="mt-8 max-w-xl">
                            <PartUploader surface="paper" />
                        </div>
                    </div>
                    <div className="rounded-3xl bg-paper-raised p-4 ring-1 ring-paper-line sm:p-6">
                        <HeroPart />
                        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-paper-line pt-4 font-mono text-xs text-ink-muted">
                            <div>
                                <dt className="eyebrow">Quote</dt>
                                <dd className="mt-1 text-ink">Instant</dd>
                            </div>
                            <div>
                                <dt className="eyebrow">Ship date</dt>
                                <dd className="mt-1 text-ink">On every quote</dd>
                            </div>
                            <div>
                                <dt className="eyebrow">Inspection</dt>
                                <dd className="mt-1 text-ink">Every order</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </section>

            <section aria-labelledby="make-anything" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
                <div className="flex items-end justify-between gap-4">
                    <h2 id="make-anything" className="font-display font-wide text-2xl font-bold text-ink sm:text-3xl">
                        Make anything
                    </h2>
                    <Link href="/make" className="hidden items-center gap-1 rounded text-sm font-semibold text-ink hover:underline sm:inline-flex">
                        Start a part <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                </div>
                <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {TILES.map((t) => {
                        const inner = (
                            <>
                                <span className="flex items-center justify-between gap-2">
                                    <span className="font-display text-lg font-bold text-ink">{t.title}</span>
                                    {t.available ? (
                                        <ArrowRight className="h-4 w-4 text-ink-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                                    ) : (
                                        <span className="rounded-full bg-paper-line px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Soon</span>
                                    )}
                                </span>
                                <span className="mt-2 block text-sm leading-snug text-ink-muted">{t.body}</span>
                            </>
                        )
                        return (
                            <li key={t.title}>
                                {t.available ? (
                                    <Link href="/make" className="group block h-full rounded-2xl bg-paper-raised p-4 ring-1 ring-paper-line transition-shadow hover:shadow-lg sm:p-5">
                                        {inner}
                                    </Link>
                                ) : (
                                    <div className="block h-full rounded-2xl bg-paper/60 p-4 opacity-80 border border-dashed border-paper-line sm:p-5" aria-disabled="true">
                                        {inner}
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ul>
            </section>

            <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 border-y border-paper-line bg-paper-raised">
                <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
                    <h2 id="how-heading" className="font-display font-wide text-2xl font-bold text-ink sm:text-3xl">
                        How it works
                    </h2>
                    <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        {STEPS.map((s, i) => (
                            <li key={s.title} className="relative">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-paper">
                                        <s.icon className="h-5 w-5" aria-hidden />
                                    </span>
                                    <span className="font-mono text-xs text-ink-subtle">Step {i + 1} of 4</span>
                                </div>
                                <h3 className="mt-4 font-display text-lg font-bold text-ink">{s.title}</h3>
                                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <section id="materials" aria-labelledby="materials-heading" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
                    <h2 id="materials-heading" className="font-display font-wide text-2xl font-bold text-ink sm:text-3xl">
                        Materials in stock
                    </h2>
                    <p className="text-sm text-ink-muted">Finishes: powder coat in five colors, Type II anodize, deburring.</p>
                </div>
                <MaterialsStrip />
            </section>

            <section aria-label="Why DiscoverMake" className="border-t border-paper-line">
                <ul className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
                    {TRUST.map((t) => (
                        <li key={t.title} className="flex gap-3">
                            <t.icon className="mt-0.5 h-5 w-5 shrink-0 text-[#1d6b3a]" aria-hidden />
                            <div>
                                <p className="font-semibold text-ink">{t.title}</p>
                                <p className="mt-0.5 text-sm text-ink-muted">{t.body}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>
        </>
    )
}
