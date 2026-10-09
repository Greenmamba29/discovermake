'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useMe } from '@/components/site/use-account';
import { MIN_INTERESTS, ONBOARDED_KEY, TOUR_DISMISSED_KEY } from './onboarding-state';

function readFlag(key: string): boolean {
    try {
        return window.localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

/**
 * "New here? Take the 60-second tour" on Home: an invitation, never a forced redirect.
 * Hidden once dismissed, once onboarding finished on this device, or when the account
 * (or guest device) already has onboarding answers.
 */
export function TourEntry() {
    const { data: me, isLoading } = useMe();
    const [hidden, setHidden] = useState(true);

    useEffect(() => {
        setHidden(readFlag(TOUR_DISMISSED_KEY) || readFlag(ONBOARDED_KEY));
    }, []);

    const onboarded = Boolean(me?.viewer?.onboardedAt) || Boolean(me?.preferences.intent && me.preferences.interests.length >= MIN_INTERESTS);
    if (hidden || isLoading || onboarded) return null;

    const dismiss = () => {
        try {
            window.localStorage.setItem(TOUR_DISMISSED_KEY, '1');
        } catch {
            // ignore
        }
        setHidden(true);
    };

    return (
        <aside aria-label="New here?" className="mb-6 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 rounded-2xl bg-ink p-3 pl-4 text-paper sm:flex sm:gap-3 sm:p-4 sm:pl-5" data-testid="tour-entry">
            <p className="min-w-0 text-sm sm:flex-1">
                <Sparkles className="mr-1.5 inline h-4 w-4 align-[-2px] text-signal" aria-hidden />
                <span className="font-semibold">New here?</span> <span className="text-paper/80">Pick what you love and get a real quote in a minute.</span>
            </p>
            <button type="button" onClick={dismiss} aria-label="Dismiss the tour" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-paper/80 hover:bg-white/10 hover:text-paper sm:order-last" data-testid="tour-dismiss">
                <X className="h-4 w-4" aria-hidden />
            </button>
            <Link href="/onboarding" className="col-span-2 inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-signal px-3.5 text-sm font-semibold text-signal-ink hover:bg-signal-strong" data-testid="tour-start">
                Take the 60-second tour
                <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
        </aside>
    );
}
