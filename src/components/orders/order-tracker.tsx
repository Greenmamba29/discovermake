'use client';

import Link from 'next/link';
import { BadgeCheck, ChevronRight, Factory, MapPin, RotateCcw, Star } from 'lucide-react';
import type { OrderView } from '@/contracts';
import { ButtonLink } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { FlatPattern } from '@/components/part/part-preview';
import { ApiClientError, errorMessage } from '@/lib/api';
import { dateTime, money, shortDate } from '@/lib/format';
import { ShipmentCard } from './shipment-card';
import { SupplierRouteTracker } from '@/components/prime/supplier-route-tracker';
import { Timeline } from './timeline';
import { TrackingStepper } from './tracking-stepper';
import { isTerminalOrder, useOrder } from './use-order';

/** ETA first (Uber rule): one short line under the status sentence. */
export function etaLine(o: OrderView): string {
    if (o.deliveredAt) return `Delivered ${shortDate(o.deliveredAt)}`;
    if (o.status === 'PENDING_PAYMENT') return 'Production starts as soon as payment is confirmed';
    if (o.status === 'PAYMENT_FAILED') return 'Nothing was charged';
    if (o.status === 'CANCELLED' || o.status === 'REFUNDED') return o.status === 'REFUNDED' ? 'Your payment was refunded' : 'This order was cancelled';
    // R3 Delivery Promise: one committed date, shown only when its P90 fits.
    if (o.promise?.show) return `Arrives ${shortDate(o.promise.date)}`;
    if (o.shipment?.estimatedDeliveryDate) return `Arrives ${shortDate(o.shipment.estimatedDeliveryDate)}`;
    if (o.shipment) return `Shipped ${shortDate(o.shipment.shippedAt ?? o.shipment.createdAt)}`;
    return `Ships by ${shortDate(o.promisedShipDate)}`;
}

export function orderLink(orderId: string, token: string, sub = ''): string {
    return `/orders/${orderId}${sub}?t=${encodeURIComponent(token)}`;
}

export function MissingToken() {
    return (
        <ErrorState
            title="This order link is incomplete"
            message="Order pages open from the private link in your confirmation email. Paste the full link on the Track order page."
            action={<ButtonLink href="/orders">Track an order</ButtonLink>}
        />
    );
}

export function OrderLoadError({ error }: { error: unknown }) {
    const denied = error instanceof ApiClientError && (error.status === 401 || error.status === 403 || error.status === 404);
    return (
        <ErrorState
            title={denied ? 'We could not open this order' : 'Could not load your order'}
            message={denied ? 'The link is invalid or has been revoked. Use the most recent link from your confirmation email.' : errorMessage(error)}
            action={<ButtonLink href="/orders">Track an order</ButtonLink>}
        />
    );
}

export function OrderTracker({ orderId, token }: { orderId: string; token: string | null }) {
    const { data: order, error, isLoading, dataUpdatedAt, isFetching } = useOrder(orderId, token);
    if (!token) return <MissingToken />;
    if (isLoading) return <PageSkeleton label="Loading your order" />;
    if (error && !order) return <OrderLoadError error={error} />;
    if (!order) return null;

    const active = !isTerminalOrder(order.status);
    const s = order.summary;

    return (
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
            {/* Status first: one plain sentence + ETA */}
            <section aria-labelledby="order-status" className="rounded-3xl bg-graphite-900 p-5 ring-1 ring-graphite-700 sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="eyebrow">
                        Order {order.orderNumber} · {order.build.displayId}
                    </p>
                    <StatusPill status={order.universalStatus} />
                </div>
                <h1 id="order-status" className="mt-3 font-display font-wide text-3xl font-extrabold leading-tight sm:text-4xl" data-testid="order-status" aria-live="polite">
                    {order.statusLabel}
                </h1>
                {!/\b(ships|arrives)\b/i.test(order.statusLabel) && (
                    <p className="mt-1 text-lg text-signal" data-testid="order-eta">
                        {etaLine(order)}
                    </p>
                )}
                <div className="mt-6">
                    <TrackingStepper steps={order.steps} />
                </div>
                <p className="mt-4 font-mono text-[11px] text-fg-subtle" aria-live="off">
                    {active ? (isFetching ? 'Checking for updates…' : `Live · updated ${new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`) : 'Final status'}
                </p>
            </section>

            {order.status === 'PENDING_PAYMENT' && (
                <Notice tone="info" className="mt-4" title="Waiting for payment confirmation">
                    This page updates by itself once your payment provider confirms the charge.
                </Notice>
            )}
            {order.status === 'PAYMENT_FAILED' && (
                <Notice tone="error" className="mt-4" title="Your payment did not go through" action={<ButtonLink href={`/checkout/${order.quoteId}`} size="sm">Try checkout again</ButtonLink>}>
                    Nothing was charged and production has not started.
                </Notice>
            )}
            {order.promise?.status === 'MISSED' && order.promise.creditCents != null && (
                <Notice tone="warning" className="mt-4" title="We missed your delivery date" testId="promise-credit">
                    {money(order.promise.creditCents, order.currency)} credit is on your account and comes off your next order automatically.
                </Notice>
            )}
            {order.status === 'QA_FAILED' && (
                <Notice tone="warning" className="mt-4" title="A part did not pass inspection">
                    The shop is remaking it at no cost to you. Nothing ships until inspection passes.
                </Notice>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                    {order.passport && (
                        <Link
                            href={`/passport/${order.passport.id}`}
                            className="flex items-center gap-4 rounded-2xl bg-paper p-4 text-ink ring-1 ring-paper-line transition-shadow hover:shadow-lg sm:p-5"
                            data-testid="passport-card"
                        >
                            <BadgeCheck className="h-8 w-8 shrink-0 text-[#1d6b3a]" aria-hidden />
                            <span className="min-w-0 flex-1">
                                <span className="block font-display text-lg font-bold">Product Passport is active</span>
                                <span className="block text-sm text-ink-muted">Signed record of material, shop, milestones and inspection · activated {shortDate(order.passport.activatedAt)}</span>
                            </span>
                            <ChevronRight className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden />
                        </Link>
                    )}

                    {order.supplierRoute && <SupplierRouteTracker orderId={order.id} token={token} route={order.supplierRoute} currency={order.currency} />}

                    {order.shipment && <ShipmentCard shipment={order.shipment} />}

                    <section aria-labelledby="updates-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 id="updates-heading" className="font-display text-lg font-bold">
                                Live updates
                            </h2>
                            {['ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED'].includes(order.status) && (
                                <Link href={orderLink(order.id, token, '/production')} className="inline-flex items-center gap-1 rounded text-sm font-semibold text-signal hover:underline">
                                    Production details <ChevronRight className="h-4 w-4" aria-hidden />
                                </Link>
                            )}
                        </div>
                        <Timeline entries={order.timeline} />
                    </section>
                </div>

                <div className="space-y-6">
                    <section aria-labelledby="shop-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="shop-card">
                        <h2 id="shop-heading" className="eyebrow">
                            Made by
                        </h2>
                        {order.supplierRoute && (
                            <p className="mt-3 text-sm text-fg" data-testid="supplier-made-by">
                                {order.supplierRoute.label}
                                {order.shop ? <span className="text-fg-muted"> · inspected and shipped by {order.shop.name}</span> : null}
                            </p>
                        )}
                        {order.supplierRoute ? null : order.shop ? (
                            <div className="mt-3 flex gap-3">
                                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-graphite-750" aria-hidden>
                                    <Factory className="h-6 w-6" />
                                </span>
                                <div>
                                    <p className="font-semibold text-fg">{order.shop.name}</p>
                                    <p className="flex flex-wrap gap-x-3 text-sm text-fg-muted">
                                        <span className="inline-flex items-center gap-1">
                                            <MapPin className="h-3.5 w-3.5" aria-hidden /> {order.shop.city}, {order.shop.region}
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <Star className="h-3.5 w-3.5" aria-hidden /> {order.shop.rating != null ? order.shop.rating.toFixed(1) : 'New partner'}
                                        </span>
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <p className="mt-3 text-sm text-fg-muted">{order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED' ? 'A partner shop is assigned after payment.' : 'Matching your order with a partner shop that has the machine and material ready.'}</p>
                        )}
                    </section>

                    <section aria-labelledby="details-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5">
                        <h2 id="details-heading" className="font-display text-lg font-bold">
                            Your parts
                        </h2>
                        <div className="mt-3 flex gap-3">
                            {order.preview && (
                                <div className="h-20 w-20 shrink-0 rounded-xl bg-graphite-850 p-2 ring-1 ring-graphite-700">
                                    <FlatPattern preview={order.preview} />
                                </div>
                            )}
                            <div className="min-w-0 text-sm">
                                <p className="truncate font-semibold">{s.partFilename}</p>
                                <p className="text-fg-muted">
                                    {s.quantity} × {s.materialName} · {s.thicknessLabel}
                                </p>
                                <p className="text-fg-muted">{[s.finishName ?? 'As cut', ...s.serviceNames].join(' · ')}</p>
                                <p className="font-mono text-xs text-fg-subtle">design v{order.designVersion}</p>
                            </div>
                        </div>
                        <dl className="mt-4 space-y-1.5 border-t border-graphite-700 pt-3 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-fg-muted">Parts</dt>
                                <dd className="font-mono tabular">{money(order.subtotalCents, order.currency)}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-fg-muted">Shipping</dt>
                                <dd className="font-mono tabular">{money(order.shippingCents, order.currency)}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-fg-muted">Tax</dt>
                                <dd className="font-mono tabular">{money(order.taxCents, order.currency)}</dd>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <dt>Total paid</dt>
                                <dd className="font-mono tabular">{money(order.totalCents, order.currency)}</dd>
                            </div>
                        </dl>
                        <div className="mt-4 border-t border-graphite-700 pt-3 text-sm">
                            <p className="eyebrow">Ship to</p>
                            <address className="mt-1 not-italic text-fg-muted">
                                {order.shippingAddress.name}
                                {order.shippingAddress.company && <>, {order.shippingAddress.company}</>}
                                <br />
                                {order.shippingAddress.line1}
                                {order.shippingAddress.line2 && <>, {order.shippingAddress.line2}</>}
                                <br />
                                {order.shippingAddress.city}, {order.shippingAddress.region} {order.shippingAddress.postalCode}
                            </address>
                            <p className="mt-2 text-xs text-fg-subtle">Placed {dateTime(order.createdAt)}</p>
                        </div>
                    </section>

                    <ButtonLink href={`/build/${order.build.id}/configure?from=${order.quoteId}`} variant="secondary" className="w-full" data-testid="reorder">
                        <RotateCcw className="h-4 w-4" aria-hidden /> Reorder this part
                    </ButtonLink>
                </div>
            </div>
        </div>
    );
}
