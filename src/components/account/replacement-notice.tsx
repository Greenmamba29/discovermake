import { Wrench } from 'lucide-react'

/** Repair (workflow 09): the configure page in "replacement part" mode, a quote for just this part. */
export function ReplacementNotice() {
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6" data-testid="replacement-notice">
            <p className="flex items-start gap-2 rounded-xl bg-graphite-800 p-3 text-sm text-fg-muted ring-1 ring-inset ring-graphite-600" role="status">
                <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                <span>
                    <span className="font-semibold text-fg">Replacement part.</span> Pick how many you need to replace and check out. Only this part is made.
                </span>
            </p>
        </div>
    )
}
