import Link from 'next/link';

/** Kids mode pages when there is no live kid session. */
export function KidsNotActive({ ended }: { ended: boolean }) {
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8" data-testid={ended ? 'kids-ended' : 'kids-not-active'}>
            <h1 className="text-3xl font-extrabold text-ink">{ended ? 'Kids mode is over' : 'Kids mode'}</h1>
            {ended ? (
                <>
                    <p className="text-lg text-ink-muted">Hand the device back to your grown-up. They can start Kids mode again.</p>
                    <Link href="/kids/exit" className="flex h-16 items-center justify-center rounded-2xl bg-ink text-xl font-extrabold text-paper" data-testid="kids-ended-exit">
                        Grown-up: unlock
                    </Link>
                </>
            ) : (
                <>
                    <p className="text-lg text-ink-muted">Kids design their own things here, then ask a grown-up to say yes. A grown-up starts Kids mode from their Family page.</p>
                    <Link href="/family" className="flex h-16 items-center justify-center rounded-2xl bg-ink text-xl font-extrabold text-paper" data-testid="kids-go-family">
                        Grown-ups: open Family
                    </Link>
                </>
            )}
        </div>
    );
}
