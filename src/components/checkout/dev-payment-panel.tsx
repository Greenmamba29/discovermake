'use client';

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/state';
import { api, errorMessage } from '@/lib/api';

/**
 * Dev payment double (PAYMENT_PROVIDER=dev, refused by the server in production).
 * Posts to POST /api/checkout/dev-confirm, which runs the same webhook pipeline as Stripe,
 * then follows the server's redirectUrl (the signed order link).
 */
export function DevPaymentPanel({ providerRef, amountLabel }: { providerRef: string; amountLabel?: string }) {
    const [busy, setBusy] = useState<'succeeded' | 'failed' | null>(null);
    const [error, setError] = useState<string | null>(null);

    const confirm = async (outcome: 'succeeded' | 'failed') => {
        setBusy(outcome);
        setError(null);
        try {
            const res = await api.devConfirm({ providerRef, outcome });
            window.location.assign(res.redirectUrl);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(null);
        }
    };

    return (
        <section aria-labelledby="dev-pay-heading" className="rounded-2xl bg-amber/10 p-4 ring-1 ring-inset ring-amber/40 sm:p-5" data-testid="dev-payment-panel">
            <div className="flex items-start gap-3">
                <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-amber" aria-hidden />
                <div className="min-w-0 flex-1">
                    <h2 id="dev-pay-heading" className="font-semibold text-fg">
                        Test payment (dev only)
                    </h2>
                    <p className="mt-1 text-sm text-fg-muted">
                        This environment uses the development payment provider. No card is charged. Confirming runs the real order pipeline: payment recorded, order paid, and the job dispatched to a partner shop.
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-fg-subtle">ref {providerRef}</p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <Button onClick={() => confirm('succeeded')} loading={busy === 'succeeded'} disabled={busy !== null} data-testid="dev-pay-button">
                            {amountLabel ? `Confirm test payment · ${amountLabel}` : 'Confirm test payment'}
                        </Button>
                        <Button variant="secondary" onClick={() => confirm('failed')} loading={busy === 'failed'} disabled={busy !== null} data-testid="dev-pay-fail">
                            Simulate a declined card
                        </Button>
                    </div>
                    {error && (
                        <Notice tone="error" className="mt-3" title="Test payment failed">
                            {error}
                        </Notice>
                    )}
                </div>
            </div>
        </section>
    );
}
