import Link from 'next/link'
import { Eye } from 'lucide-react'

/**
 * Shown above a build the viewer cannot change (ADR-0009). Edits are refused by the API
 * (403); this tells the viewer why before they try, and offers the way forward.
 */
export function ReadOnlyBuildBanner({ buildId }: { buildId: string }) {
    const next = `/build/${encodeURIComponent(buildId)}/workspace`
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6" data-testid="build-read-only">
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-graphite-800 p-3 text-sm ring-1 ring-inset ring-graphite-600" role="status">
                <Eye className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                <p className="min-w-0 flex-1 text-fg-muted">
                    You are viewing someone else&apos;s build. Only its owner can answer questions, approve versions or generate CAD. Remix it to make your own copy.
                </p>
                <Link href={`/signin?next=${encodeURIComponent(next)}`} className="font-semibold text-signal hover:underline">
                    Sign in
                </Link>
            </div>
        </div>
    )
}
