'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckCircle2, Factory, Radio, Truck } from 'lucide-react';
import type { WatchMyBuildView, WatchPost } from '@/contracts/media';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LiveBadge } from '@/components/live/live-badge';
import { mediaApi } from './media-api';

const ICON: Partial<Record<WatchPost['kind'], typeof Factory>> = { shipped: Truck, delivered: Truck, qa_passed: CheckCircle2, paid: CheckCircle2 };

/**
 * `/orders/:orderId/watch` (workflow 09 Watch My Build): the buyer's own production stream.
 * Every Shop Console milestone posts here with its time and the shop's photos; the shop's
 * build-live camera is embedded when there is one. Refreshes every 10 s while in production.
 */
export function WatchMyBuild({ orderId, token }: { orderId: string; token: string | null }) {
    const watch = useQuery({
        queryKey: ['watch', orderId, token],
        queryFn: () => mediaApi.watch(orderId, token),
        retry: false,
        refetchInterval: (q) => (q.state.data && ['DELIVERED', 'COMPLETE', 'CANCELLED', 'REFUNDED'].includes(q.state.data.status) ? false : 10_000),
    });
    if (watch.isLoading) return <PageSkeleton label="Opening your build stream" />;
    if (watch.error || !watch.data) {
        const notFound = watch.error instanceof ApiClientError && watch.error.status === 404;
        return (
            <ErrorState
                title={notFound ? 'We could not find that order' : 'Could not load your build stream'}
                message={notFound ? 'Use the full link from your confirmation email, or sign in with the account that placed the order.' : errorMessage(watch.error)}
                action={<ButtonLink href="/orders">Track an order</ButtonLink>}
            />
        );
    }
    return <Stream view={watch.data} token={token} />;
}

function Stream({ view, token }: { view: WatchMyBuildView; token: string | null }) {
    const orderHref = `/orders/${view.orderId}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
    const posts = [...view.posts].reverse();
    return (
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6" data-testid="watch-my-build" data-status={view.status}>
            <Link href={orderHref} className="text-sm text-fg-muted hover:text-fg">
                ← Order {view.orderNumber}
            </Link>
            <p className="eyebrow mt-3">Watch My Build</p>
            <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">{view.buildTitle}</h1>
            <p className="mt-1 text-sm text-fg-muted">
                {view.shopName ? `Being made by ${view.shopName}` : 'Waiting for a partner shop'} · {view.inProduction ? 'in production now' : view.status.toLowerCase().replace('_', ' ')}
            </p>

            {view.camera ? (
                <section aria-labelledby="camera-heading" className="mt-6 overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="watch-camera">
                    <div className="flex items-center justify-between gap-2 p-3">
                        <h2 id="camera-heading" className="flex items-center gap-2 font-display text-base font-bold">
                            <Radio className="h-4 w-4 text-live" aria-hidden /> {view.camera.channelName} · {view.camera.title}
                        </h2>
                        <LiveBadge status={view.camera.status} viewerCount={0} />
                    </div>
                    {view.camera.source.kind === 'mp4' || view.camera.source.kind === 'hls' ? (
                        <video src={view.camera.source.url} autoPlay muted playsInline controls className="aspect-video w-full bg-black" aria-label={`${view.camera.title} camera`} />
                    ) : (
                        <p className="px-3 pb-3 text-sm text-fg-muted">The shop camera opens in the live player.</p>
                    )}
                    <div className="p-3 pt-0">
                        <ButtonLink href={`/live/${view.camera.showId}`} size="sm" data-testid="watch-camera-link">
                            Watch live
                        </ButtonLink>
                    </div>
                </section>
            ) : (
                view.inProduction && <p className="mt-6 rounded-xl bg-graphite-850 p-3 text-sm text-fg-muted ring-1 ring-graphite-700">The shop has no camera on this cell right now, so each step is posted here with the shop&apos;s photos as it happens.</p>
            )}

            <section aria-labelledby="stream-heading" className="mt-6">
                <h2 id="stream-heading" className="font-display text-lg font-bold">
                    Production stream
                </h2>
                {posts.length === 0 ? (
                    <p className="mt-2 text-sm text-fg-muted">Nothing yet. The first post appears when the payment is confirmed and the shop accepts your job.</p>
                ) : (
                    <ol className="mt-3 space-y-3" data-testid="watch-posts">
                        {posts.map((p, i) => {
                            const Icon = ICON[p.kind] ?? Factory;
                            return (
                                <li key={p.id} className={cn('rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700', i === 0 && 'ring-signal/40')} data-testid="watch-post" data-kind={p.kind}>
                                    <div className="flex items-start gap-3">
                                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-graphite-800" aria-hidden>
                                            <Icon className={cn('h-4 w-4', i === 0 ? 'text-signal' : 'text-fg-muted')} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold">{p.label}</p>
                                            <p className="text-xs text-fg-muted">
                                                <time dateTime={p.at}>{dateTime(p.at)}</time> · {p.actor === 'shop' ? view.shopName ?? 'Shop' : p.actor === 'carrier' ? 'Carrier' : 'DiscoverMake'}
                                            </p>
                                            {p.note && <p className="mt-1 text-sm text-fg-muted">{p.note}</p>}
                                            {p.photoUrls.length > 0 && (
                                                <div className="mt-2 flex gap-2 overflow-x-auto">
                                                    {p.photoUrls.map((u, k) => (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img key={u} src={u} alt={`Shop photo ${k + 1}: ${p.label}`} className="h-24 w-24 shrink-0 rounded-lg object-cover ring-1 ring-graphite-700" loading="lazy" />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </section>
        </div>
    );
}
