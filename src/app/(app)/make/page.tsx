import type { Metadata } from 'next'
import { CheckCircle2 } from 'lucide-react'
import { PartUploader } from '@/components/upload/part-uploader'

export const metadata: Metadata = { title: 'Upload a part' }

const TIPS = [
    'Export the flat pattern at 1:1 scale. Millimetres or inches both work; we ask if the units are unclear.',
    'Close every cut contour. Open lines cannot be cut and are flagged before you order.',
    'Put bend lines on a layer named BEND to add press-brake bending.',
    'Convert text to outlines. Live text entities are not cut.',
] as const

export default function MakePage() {
    return (
        <div className="grid-bg flex-1">
            <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
                <p className="eyebrow">Step 1 of 4 · Upload</p>
                <h1 className="mt-3 font-display font-wide text-3xl font-extrabold tracking-tight sm:text-5xl">What do you want to make?</h1>
                <p className="mt-4 max-w-xl text-fg-muted">
                    Drop a DXF and we analyze it in seconds. Next you pick material, thickness and finish and see a binding price for every quantity.
                </p>
                <div className="mt-8">
                    <PartUploader autoFocus />
                </div>
                <section aria-labelledby="dxf-tips" className="mt-12 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700 sm:p-6">
                    <h2 id="dxf-tips" className="font-display text-lg font-bold">
                        Getting a clean quote
                    </h2>
                    <ul className="mt-4 space-y-3">
                        {TIPS.map((t) => (
                            <li key={t} className="flex gap-3 text-sm text-fg-muted">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                                {t}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-5 text-xs text-fg-subtle">Files are stored privately and shared only with the partner shop that makes your order.</p>
                </section>
            </div>
        </div>
    )
}
