'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Gavel } from 'lucide-react';
import { PlaceBidRequest, type AuctionView, type PlaceBidResponse } from '@/contracts/live';
import { Button } from '@/components/ui/button';
import { Field, SelectInput, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { US_STATES } from '@/lib/us-states';
import { cn } from '@/lib/utils';
import { mediaApi } from '@/components/media/media-api';
import { AuctionCountdown } from './auction-countdown';
import { Sheet } from './sheet';

const SHIP_KEY = 'dm_bid_ship_to_v1';
type ShipTo = { name: string; line1: string; city: string; region: string; postalCode: string };

function loadShipTo(): ShipTo {
    try {
        const raw = window.sessionStorage.getItem(SHIP_KEY);
        if (raw) return { name: '', line1: '', city: '', region: '', postalCode: '', ...(JSON.parse(raw) as Partial<ShipTo>) };
    } catch {
        // storage unavailable
    }
    return { name: '', line1: '', city: '', region: '', postalCode: '' };
}

/** Whatnot-style auction card over the stream: current bid, countdown, "Bid $X" and "Custom". */
export function AuctionCard({ auction, signedIn, isHost, onBid }: { auction: AuctionView; signedIn: boolean; isHost: boolean; onBid: (amountCents: number | null) => void }) {
    const open = auction.status === 'OPEN';
    const leading = !!auction.viewerBid && auction.viewerBid.amountCents === auction.currentBidCents;
    const outbid = !!auction.viewerBid && !leading && open;
    return (
        <section aria-labelledby="auction-card-heading" className="rounded-2xl bg-graphite-900/95 p-3 ring-1 ring-graphite-700" data-testid="auction-card" data-status={auction.status} data-leading={leading ? 'true' : 'false'}>
            <div className="flex items-center justify-between gap-2">
                <h2 id="auction-card-heading" className="flex min-w-0 items-center gap-1.5 truncate font-display text-sm font-bold">
                    <Gavel className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden /> {open ? 'Live auction' : 'Auction ended'} · {auction.title}
                </h2>
                {open && <AuctionCountdown endsAt={auction.endsAt} extensions={auction.extensions} />}
            </div>
            <p className="mt-1 text-sm" data-testid="auction-current" aria-live="polite">
                {auction.currentBidCents !== null ? (
                    <>
                        <span className="font-display text-lg font-bold tabular">{money(auction.currentBidCents, auction.currency)}</span>
                        <span className="text-fg-muted"> · {auction.leadingBidder ?? 'a bidder'} · {auction.bidCount} bid{auction.bidCount === 1 ? '' : 's'}</span>
                    </>
                ) : (
                    <span className="text-fg-muted">Starting bid {money(auction.startingBidCents, auction.currency)}</span>
                )}
            </p>
            {!open && (
                <p className="mt-1 text-sm text-fg-muted" data-testid="auction-result">
                    {auction.status === 'SOLD' ? `Sold to ${auction.winner ?? 'the top bidder'}` : auction.status === 'UNSOLD' ? 'No authorized bid: not sold.' : 'Cancelled.'}
                    {auction.viewerBid?.status === 'WON' ? ' You won! Your hold was charged.' : auction.viewerBid ? ' Your holds were released.' : ''}
                </p>
            )}
            {leading && open && (
                <p className="mt-1 text-xs font-semibold text-signal" data-testid="auction-leading">
                    You are winning{auction.viewerBid && !auction.viewerBid.authorized ? ' · authorize your hold to stay eligible' : ''}
                </p>
            )}
            {outbid && (
                <p className="mt-1 text-xs font-semibold text-amber" role="status" data-testid="auction-outbid">
                    You were outbid. Bid {money(auction.nextMinimumBidCents, auction.currency)} to take the lead.
                </p>
            )}
            {open && !isHost && (
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                    <Button size="sm" onClick={() => onBid(auction.nextMinimumBidCents)} disabled={!signedIn} data-testid="auction-bid">
                        Bid {money(auction.nextMinimumBidCents, auction.currency)}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onBid(null)} disabled={!signedIn} data-testid="auction-custom">
                        Custom
                    </Button>
                </div>
            )}
            {open && !signedIn && <p className="mt-1 text-xs text-fg-subtle">Sign in to bid.</p>}
        </section>
    );
}

/** Bid sheet: amount (ladder minimum or custom), ship-to, terms; then authorize the hold. */
export function BidSheet({ open, onClose, auction, initialAmountCents, onPlaced }: { open: boolean; onClose: () => void; auction: AuctionView | null; initialAmountCents: number | null; onPlaced: (r: PlaceBidResponse) => void }) {
    const [amount, setAmount] = useState('');
    const [ship, setShip] = useState<ShipTo>({ name: '', line1: '', city: '', region: '', postalCode: '' });
    const [terms, setTerms] = useState(false);
    const [placed, setPlaced] = useState<PlaceBidResponse | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !auction) return;
        setShip(loadShipTo());
        setAmount(((initialAmountCents ?? auction.nextMinimumBidCents) / 100).toFixed(2));
        setPlaced(null);
        setAuthorized(false);
        setError(null);
        // re-initialise only when the sheet opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const body = useMemo(
        () => ({ amountCents: Math.round(Number(amount) * 100), buyer: { name: ship.name }, shippingAddress: { ...ship, country: 'US' as const }, shippingMethod: 'STANDARD' as const, acceptTerms: terms }),
        [amount, ship, terms],
    );
    if (!auction) return null;
    const set = (k: keyof ShipTo, v: string) => setShip((s) => ({ ...s, [k]: v }));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        const parsed = PlaceBidRequest.safeParse(body);
        if (!parsed.success) return setError(terms ? 'Check the amount and the US shipping address (5-digit ZIP).' : 'Please accept the terms to place your bid.');
        setBusy(true);
        try {
            try {
                window.sessionStorage.setItem(SHIP_KEY, JSON.stringify(ship));
            } catch {
                // storage unavailable
            }
            const r = await mediaApi.bid(auction.id, parsed.data);
            setPlaced(r);
            onPlaced(r);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    const authorize = async () => {
        if (!placed) return;
        if (placed.payment.provider !== 'dev') {
            if (placed.checkoutUrl) window.location.assign(placed.checkoutUrl);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await api.devConfirm({ providerRef: placed.payment.providerRef, outcome: 'succeeded' });
            setAuthorized(true);
            onPlaced({ ...placed, auction: { ...placed.auction, viewerBid: placed.auction.viewerBid ? { ...placed.auction.viewerBid, authorized: true, checkoutUrl: null } : null } });
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} title={`Bid on ${auction.title}`} testId="bid-sheet">
            {!placed ? (
                <form onSubmit={submit} noValidate className="space-y-4">
                    <p className="text-sm text-fg-muted">Your bid authorizes a hold for the amount plus shipping. You are charged only if you win; every other hold is released when the auction ends.</p>
                    <Field label={`Your bid ($) · at least ${money(auction.nextMinimumBidCents, auction.currency)}`}>
                        {({ id }) => <TextInput id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="bid-amount" />}
                    </Field>
                    <Field label="Full name">{({ id }) => <TextInput id={id} autoComplete="name" value={ship.name} onChange={(e) => set('name', e.target.value)} data-testid="bid-name" />}</Field>
                    <Field label="Street address">{({ id }) => <TextInput id={id} autoComplete="address-line1" value={ship.line1} onChange={(e) => set('line1', e.target.value)} data-testid="bid-line1" />}</Field>
                    <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2">
                        <Field label="City">{({ id }) => <TextInput id={id} value={ship.city} onChange={(e) => set('city', e.target.value)} data-testid="bid-city" />}</Field>
                        <Field label="State">
                            {({ id }) => (
                                <SelectInput id={id} value={ship.region} onChange={(e) => set('region', e.target.value)} data-testid="bid-region">
                                    <option value="">–</option>
                                    {US_STATES.map(([code]) => (
                                        <option key={code} value={code}>
                                            {code}
                                        </option>
                                    ))}
                                </SelectInput>
                            )}
                        </Field>
                        <Field label="ZIP">{({ id }) => <TextInput id={id} inputMode="numeric" value={ship.postalCode} onChange={(e) => set('postalCode', e.target.value)} data-testid="bid-postal" />}</Field>
                    </div>
                    <label className="flex items-start gap-3 text-sm text-fg-muted">
                        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#5fe08a]" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="bid-terms" />
                        <span>I authorize a hold for my bid and accept the Terms. I am charged only if I win.</span>
                    </label>
                    {error && <Notice tone="error" testId="bid-error">{error}</Notice>}
                    <Button type="submit" className="w-full" loading={busy} data-testid="bid-submit">
                        <Gavel className="h-4 w-4" aria-hidden /> Place bid
                    </Button>
                </form>
            ) : (
                <div className={cn('space-y-4')} data-testid="bid-result" data-status={authorized ? 'AUTHORIZED' : 'PLACED'} data-extended={placed.extended ? 'true' : 'false'}>
                    <Notice tone="success" title={authorized ? 'Bid placed and hold authorized' : `Bid of ${money(placed.amountCents, placed.auction.currency)} placed`}>
                        {authorized ? 'You are in the running. Only authorized bids can win.' : `Authorize the hold of ${money(placed.totalCents, placed.auction.currency)} (incl. shipping) so your bid can win.`}
                        {placed.extended ? ' Your bid landed in the last seconds, so the auction got 15 more seconds.' : ''}
                    </Notice>
                    {!authorized && (
                        <Button className="w-full" onClick={authorize} loading={busy} data-testid="bid-authorize">
                            {placed.payment.provider === 'dev' ? `Authorize test payment · ${money(placed.totalCents, placed.auction.currency)}` : 'Authorize payment'}
                        </Button>
                    )}
                    {error && <Notice tone="error">{error}</Notice>}
                </div>
            )}
        </Sheet>
    );
}
