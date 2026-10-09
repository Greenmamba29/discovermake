'use client';

import { useEffect, useState } from 'react';
import type { Address } from '@/contracts/common';
import { Address as AddressSchema } from '@/contracts/common';
import type { AddressCheckResponse } from '@/contracts/prime';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { primeApi } from './api';

/**
 * Non-blocking address warnings (DoorDash "You seem far from this address"): checks the
 * address once it is complete (debounced) and offers "Use suggested address". The buyer can
 * always keep what they typed.
 */
export function AddressWarnings({ address, freight, onUseSuggestion }: { address: Partial<Address>; freight?: boolean; onUseSuggestion: (a: Address) => void }) {
    const [result, setResult] = useState<AddressCheckResponse | null>(null);
    const parsed = AddressSchema.safeParse({ ...address, country: 'US' });
    const key = parsed.success ? JSON.stringify(parsed.data) : null;

    useEffect(() => {
        if (!key) {
            setResult(null);
            return;
        }
        const t = setTimeout(() => {
            primeApi
                .checkAddress({ address: JSON.parse(key) as Address, freight })
                .then(setResult)
                .catch(() => setResult(null));
        }, 600);
        return () => clearTimeout(t);
    }, [key, freight]);

    if (!result || result.warnings.length === 0) return null;
    const s = result.suggestion;
    return (
        <Notice
            tone="warning"
            title="Check this address"
            testId="address-warnings"
            action={
                s ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => onUseSuggestion(s)} data-testid="use-suggested-address">
                        Use suggested address
                    </Button>
                ) : undefined
            }
        >
            <ul className="list-disc space-y-0.5 pl-4">
                {result.warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                ))}
            </ul>
            {s && (
                <p className="mt-2 text-xs text-fg-subtle">
                    Suggested: {s.line1}
                    {s.line2 ? `, ${s.line2}` : ''}, {s.city}, {s.region} {s.postalCode}
                </p>
            )}
            <p className="mt-1 text-xs text-fg-subtle">You can keep the address as typed.</p>
        </Notice>
    );
}
