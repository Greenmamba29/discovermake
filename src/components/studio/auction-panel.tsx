'use client';

import { useState, type FormEvent } from 'react';
import { Gavel } from 'lucide-react';
import type { AuctionView, FeaturedProduct, HostIntent } from '@/contracts/live';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Field, SelectInput, TextInput } from '@/components/ui/field';
import { money } from '@/lib/format';
import { AuctionCountdown } from '@/components/live/auction-countdown';

/** Host control for a one-of-one live auction (Whatnot Custom + Bid). */
export function AuctionPanel({ auction, featured, disabled, busy, send }: { auction: AuctionView | null; featured: FeaturedProduct[]; disabled: boolean; busy: string | null; send: (k: string, i: HostIntent, ok?: string) => Promise<void> }) {
    const buyable = featured.filter((f) => f.canBuy);
    const [buildId, setBuildId] = useState('');
    const [start, setStart] = useState('');
    const [increment, setIncrement] = useState('5');
    const [seconds, setSeconds] = useState('120');
    const selected = buyable.find((f) => f.buildId === (buildId || buyable[0]?.buildId));
    const open = auction?.status === 'OPEN';

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!selected) return;
        void send('auction', { intent: 'start_auction', buildId: selected.buildId, startingBidCents: Math.round(Number(start) * 100), minIncrementCents: Math.round(Number(increment) * 100), durationSeconds: Number(seconds) }, 'Auction is live.');
    };

    return (
        <section aria-labelledby="auction-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700" data-testid="auction-panel">
            <h2 id="auction-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                <Gavel className="h-5 w-5 text-fg-muted" aria-hidden /> Live auction · one of one
            </h2>
            {auction && (
                <div className="mt-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700" data-testid="control-auction" data-status={auction.status}>
                    <p className="font-semibold">{auction.title}</p>
                    <p className="text-sm text-fg-muted" data-testid="control-auction-bid">
                        {auction.currentBidCents !== null ? `${money(auction.currentBidCents)} by ${auction.leadingBidder ?? 'a bidder'}` : `Starts at ${money(auction.startingBidCents)}`} · {auction.bidCount} bid{auction.bidCount === 1 ? '' : 's'}
                        {auction.status !== 'OPEN' ? ` · ${auction.status.toLowerCase()}${auction.winner ? ` to ${auction.winner}` : ''}` : ''}
                    </p>
                    {open && (
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                            <AuctionCountdown endsAt={auction.endsAt} extensions={auction.extensions} />
                            <ConfirmAction label="End auction" confirmLabel="End now" variant="caution" prompt="End the auction now? The highest authorized bid wins." onConfirm={() => send('close-auction', { intent: 'close_auction' }, 'Auction closed.')} loading={busy === 'close-auction'} testId="close-auction" />
                        </div>
                    )}
                </div>
            )}
            {!open && !disabled && (
                <form onSubmit={submit} className="mt-3 space-y-3" data-testid="auction-form">
                    {buyable.length === 0 ? (
                        <p className="text-sm text-fg-muted">An auction needs a featured build with an orderable binding quote.</p>
                    ) : (
                        <>
                            <Field label="Build">
                                {({ id }) => (
                                    <SelectInput id={id} value={selected?.buildId ?? ''} onChange={(e) => setBuildId(e.target.value)} data-testid="auction-build">
                                        {buyable.map((f) => (
                                            <option key={f.buildId} value={f.buildId}>
                                                {f.name}
                                            </option>
                                        ))}
                                    </SelectInput>
                                )}
                            </Field>
                            <div className="grid grid-cols-3 gap-3">
                                <Field label="Starting bid ($)">{({ id }) => <TextInput id={id} inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} data-testid="auction-start" />}</Field>
                                <Field label="Min raise ($)">{({ id }) => <TextInput id={id} inputMode="decimal" value={increment} onChange={(e) => setIncrement(e.target.value)} data-testid="auction-increment" />}</Field>
                                <Field label="Seconds">{({ id }) => <TextInput id={id} inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} data-testid="auction-seconds" />}</Field>
                            </div>
                            <p className="text-xs text-fg-subtle">The starting bid must cover the binding quote for one. A bid in the last 10 seconds adds 15 seconds.</p>
                            <Button type="submit" loading={busy === 'auction'} data-testid="auction-start-submit">
                                Start auction
                            </Button>
                        </>
                    )}
                </form>
            )}
        </section>
    );
}
