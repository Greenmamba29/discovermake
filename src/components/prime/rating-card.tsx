'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Camera, Star } from 'lucide-react';
import { MAX_CAPTION_CHARS, RATING_TAG_LABELS, RATING_TAGS, type RatingTag } from '@/contracts/prime';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { primeApi } from './api';

const STAR_WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

/** DoorDash "rate your order" at the end + "show what you made" (photo + caption). Delivered orders only. */
export function RatingCard({ orderId, token, delivered }: { orderId: string; token: string | null; delivered: boolean }) {
    const qc = useQueryClient();
    const key = ['order-rating', orderId, token] as const;
    const q = useQuery({ queryKey: key, queryFn: () => primeApi.rating(orderId, token), enabled: delivered, retry: false });
    const [stars, setStars] = useState(0);
    const [tags, setTags] = useState<RatingTag[]>([]);
    const [caption, setCaption] = useState('');
    const [photo, setPhoto] = useState<{ key: string; name: string } | null>(null);
    const [busy, setBusy] = useState<'photo' | 'submit' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    if (!delivered || !q.data) return null;
    const data = q.data;

    if (data.rating) {
        const r = data.rating;
        return (
            <section aria-labelledby="rating-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="rating-card">
                <h2 id="rating-heading" className="font-display text-lg font-bold">
                    Your rating
                </h2>
                <p className="mt-2 flex items-center gap-1" aria-label={`${r.stars} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={cn('h-5 w-5', n <= r.stars ? 'fill-signal text-signal' : 'text-graphite-600')} aria-hidden />
                    ))}
                </p>
                {r.caption && <p className="mt-2 text-sm text-fg">{r.caption}</p>}
                {r.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.photoUrl} alt="Your photo of the finished part" className="mt-3 max-h-56 rounded-xl" />
                )}
                <p className="mt-3 text-xs text-fg-subtle" data-testid="rating-status">
                    {r.status === 'pending' ? 'Thanks! Your rating is in review and will appear on the shop once approved.' : r.status === 'approved' ? 'Published on the shop profile. Thank you!' : `Not published${r.rejectReason ? `: ${r.rejectReason}` : ''}.`}
                </p>
            </section>
        );
    }
    if (!data.eligible) return null;

    const toggle = (t: RatingTag) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
    const onFile = async (file: File | undefined) => {
        if (!file) return;
        setBusy('photo');
        setError(null);
        try {
            setPhoto({ key: await primeApi.ratingUpload(orderId, token, file), name: file.name });
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(null);
        }
    };
    const submit = async () => {
        if (!stars) {
            setError('Pick a star rating first.');
            return;
        }
        setBusy('submit');
        setError(null);
        try {
            const next = await primeApi.submitRating(orderId, token, { stars, tags, ...(caption.trim() ? { caption: caption.trim() } : {}), ...(photo ? { photoKey: photo.key } : {}) });
            qc.setQueryData(key, next);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section aria-labelledby="rating-heading" className="rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="rating-card">
            <h2 id="rating-heading" className="font-display text-lg font-bold">
                How did {data.shop?.name ?? 'your shop'} do?
            </h2>
            <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="Star rating">
                {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setStars(n)} className="rounded-lg p-1 hover:bg-graphite-800" data-testid={`rating-star-${n}`}>
                        <Star className={cn('h-8 w-8', n <= stars ? 'fill-signal text-signal' : 'text-graphite-500')} aria-hidden />
                    </button>
                ))}
                <span className="ml-2 text-sm text-fg-muted" aria-live="polite">
                    {STAR_WORDS[stars]}
                </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="What stood out">
                {RATING_TAGS.map((t) => (
                    <button
                        key={t}
                        type="button"
                        aria-pressed={tags.includes(t)}
                        onClick={() => toggle(t)}
                        className={cn('h-9 rounded-full px-3 text-sm font-semibold ring-1 ring-inset', tags.includes(t) ? 'bg-signal/15 text-signal ring-signal' : 'text-fg-muted ring-graphite-600 hover:text-fg')}
                        data-testid={`rating-tag-${t}`}
                    >
                        {RATING_TAG_LABELS[t]}
                    </button>
                ))}
            </div>
            <label className="mt-4 block text-sm font-medium text-fg" htmlFor="rating-caption">
                Show what you made <span className="text-xs font-normal text-fg-subtle">Optional</span>
            </label>
            <textarea
                id="rating-caption"
                rows={2}
                maxLength={MAX_CAPTION_CHARS}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="What did you build with it?"
                className="mt-1 w-full rounded-xl bg-graphite-850 px-3 py-2 text-sm text-fg ring-1 ring-inset ring-graphite-600 placeholder:text-fg-subtle focus:outline-none focus:ring-signal"
                data-testid="rating-caption"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="rating-photo-input" />
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={busy === 'photo'}>
                    <Camera className="h-4 w-4" aria-hidden /> {photo ? 'Change photo' : 'Add a photo'}
                </Button>
                {photo && (
                    <span className="text-xs text-signal" data-testid="rating-photo-ready">
                        {photo.name} ready
                    </span>
                )}
            </div>
            {error && (
                <Notice tone="error" className="mt-3">
                    {error}
                </Notice>
            )}
            <Button className="mt-4 w-full sm:w-auto" onClick={submit} loading={busy === 'submit'} disabled={busy !== null} data-testid="rating-submit">
                Submit rating
            </Button>
            <p className="mt-2 text-xs text-fg-subtle">Ratings and photos are reviewed before they appear on the shop profile.</p>
        </section>
    );
}
