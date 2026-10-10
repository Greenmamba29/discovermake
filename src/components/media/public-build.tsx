'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GitFork, Share2, ShoppingBag, Sparkles } from 'lucide-react';
import type { PublicBuildView } from '@/contracts/media';
import { LICENSE_LABELS } from '@/contracts/media';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { creatorLabel, LicenseChip, PreviewArt } from './build-card';
import { ClipCardView } from './clip-card';
import { mediaApi } from './media-api';
import { RemixTreeView } from './remix-tree';

/** `/b/:buildId`: the public build page (cover, creator, licence, price, Make This · Remix · Buy, remix tree). */
export function PublicBuild({ buildId }: { buildId: string }) {
    const build = useQuery({ queryKey: ['media-build', buildId], queryFn: () => mediaApi.build(buildId), retry: false });
    if (build.isLoading) return <PageSkeleton label="Loading the build" />;
    if (build.error || !build.data) {
        const notFound = build.error instanceof ApiClientError && build.error.status === 404;
        return <ErrorState title={notFound ? 'Build not found' : 'Could not load the build'} message={notFound ? 'This build is not published, or the link is wrong.' : errorMessage(build.error)} action={<ButtonLink href="/discover">Back to Discover</ButtonLink>} />;
    }
    return <BuildPage view={build.data} />;
}

function BuildPage({ view }: { view: PublicBuildView }) {
    const router = useRouter();
    const card = view.card;
    const [busy, setBusy] = useState<'clone' | 'remix' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const make = async (kind: 'clone' | 'remix') => {
        setBusy(kind);
        setError(null);
        try {
            const made = await mediaApi.make(card.buildId, kind);
            router.push(made.nextUrl);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(null);
        }
    };
    const share = async () => {
        const url = window.location.href;
        try {
            if (navigator.share) await navigator.share({ title: card.title, url });
            else {
                await navigator.clipboard.writeText(url);
                setNotice('Link copied.');
            }
        } catch {
            // dismissed
        }
    };

    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6" data-testid="public-build" data-build-id={card.buildId}>
            <Link href="/discover" className="text-sm text-fg-muted hover:text-fg">
                ← Discover
            </Link>
            <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
                <div className="min-w-0 space-y-6">
                    <div className="overflow-hidden rounded-2xl ring-1 ring-graphite-700">
                        {card.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={card.coverUrl} alt={`Cover of ${card.title}`} className="w-full object-cover" />
                        ) : (
                            <PreviewArt svg={card.previewSvg} size={card.previewSize} title={card.title} className="p-8" />
                        )}
                    </div>
                    {view.description && <p className="whitespace-pre-line text-fg-muted">{view.description}</p>}
                    {card.tags.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
                            {card.tags.map((t) => (
                                <li key={t} className="rounded-full bg-graphite-800 px-2.5 py-1 text-xs text-fg-muted">
                                    #{t}
                                </li>
                            ))}
                        </ul>
                    )}
                    <section aria-labelledby="lineage-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="lineage">
                        <h2 id="lineage-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                            <GitFork className="h-5 w-5 text-fg-muted" aria-hidden /> Remix tree
                        </h2>
                        {view.parent && (
                            <p className="mt-2 text-sm text-fg-muted" data-testid="lineage-parent">
                                Remixed from{' '}
                                {view.parent.public ? (
                                    <Link href={`/b/${view.parent.buildId}`} className="font-semibold text-fg underline underline-offset-2">
                                        {view.parent.title}
                                    </Link>
                                ) : (
                                    view.parent.title
                                )}
                                {view.parent.creatorName ? ` by ${view.parent.creatorName}` : ''}
                            </p>
                        )}
                        <div className="mt-3">{view.remixTree.children.length ? <RemixTreeView node={view.remixTree} rootLabel={false} /> : <p className="text-sm text-fg-muted">No remixes yet. Be the first.</p>}</div>
                    </section>
                    {view.clips.length > 0 && (
                        <section aria-labelledby="clips-heading">
                            <h2 id="clips-heading" className="font-display text-lg font-bold">
                                Seen on Live
                            </h2>
                            <div className="mt-3 columns-2 gap-3 sm:columns-3">
                                {view.clips.map((c) => (
                                    <ClipCardView key={c.id} clip={c} tab="build_page" />
                                ))}
                            </div>
                        </section>
                    )}
                </div>
                <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                    <div className="rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700">
                        <p className="font-mono text-xs text-fg-subtle">{card.displayId}</p>
                        <h1 className="mt-1 font-display font-wide text-2xl font-extrabold sm:text-3xl" data-testid="public-build-title">
                            {card.title}
                        </h1>
                        <p className="mt-1 text-sm text-fg-muted">
                            by{' '}
                            {card.creator.channelHandle ? (
                                <Link href={`/c/${card.creator.channelHandle}`} className="font-semibold text-fg underline-offset-2 hover:underline" data-testid="creator-link">
                                    {creatorLabel(card.creator)}
                                </Link>
                            ) : (
                                creatorLabel(card.creator)
                            )}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            <LicenseChip license={card.license} royaltyPct={card.royaltyPct} />
                            {view.visibility === 'private' && <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">Private · only you can see this</span>}
                        </div>
                        <p className="mt-2 text-xs text-fg-subtle" data-testid="license-text">
                            {LICENSE_LABELS[card.license]}: {view.licenseText}
                        </p>
                        {view.quote ? (
                            <div className="mt-4" data-testid="public-build-price">
                                <p className="font-display text-3xl font-bold tabular">{money(view.quote.unitPriceCents)}</p>
                                <p className="text-sm text-fg-muted">
                                    each at {view.quote.quantity} · {view.quote.materialLabel} · ships in {view.quote.leadTimeDays} days · binding quote
                                </p>
                            </div>
                        ) : (
                            <p className="mt-4 text-sm text-fg-muted">Make This copies the design to your own build; you get a binding price when you configure it.</p>
                        )}
                        <div className="mt-5 grid gap-2">
                            <Button onClick={() => make('clone')} loading={busy === 'clone'} disabled={!view.canMakeThis || busy !== null} data-testid="make-this">
                                <Sparkles className="h-4 w-4" aria-hidden /> Make This
                            </Button>
                            <Button variant="secondary" onClick={() => make('remix')} loading={busy === 'remix'} disabled={!view.canRemix || busy !== null} data-testid="remix">
                                <GitFork className="h-4 w-4" aria-hidden /> Remix
                            </Button>
                            {view.quote?.orderable && (
                                <ButtonLink href={`/checkout/${view.quote.quoteId}`} variant="secondary" data-testid="buy">
                                    <ShoppingBag className="h-4 w-4" aria-hidden /> Buy as listed
                                </ButtonLink>
                            )}
                            <Button variant="ghost" onClick={share} data-testid="share-build">
                                <Share2 className="h-4 w-4" aria-hidden /> Share
                            </Button>
                        </div>
                        {!view.canRemix && view.canMakeThis && <p className="mt-2 text-xs text-fg-subtle">The creator does not allow remixes of this design.</p>}
                        {card.royaltyPct > 0 && <p className="mt-2 text-xs text-fg-subtle">{card.royaltyPct}% of every Make This or remix order goes to the creator.</p>}
                        {error && (
                            <Notice tone="error" className="mt-3">
                                {error}
                            </Notice>
                        )}
                        {notice && (
                            <p className="mt-2 text-sm text-fg-muted" role="status">
                                {notice}
                            </p>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
}
