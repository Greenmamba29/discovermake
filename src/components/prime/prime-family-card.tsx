import Link from 'next/link';
import { Users } from 'lucide-react';
import { money } from '@/lib/format';
import { env } from '@/server/env';

/** Prime household (Amazon style): kids' approved orders are the member's orders, so Prime applies. */
export function PrimeFamilyCard() {
    const threshold = money(env().PRIME_FREE_SHIPPING_THRESHOLD_CENTS);
    return (
        <section className="mx-auto mb-8 w-full max-w-3xl px-4 sm:px-6" aria-labelledby="prime-family-title" data-testid="prime-family">
            <div className="flex gap-4 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700">
                <Users className="mt-0.5 h-6 w-6 shrink-0 text-signal" aria-hidden />
                <div>
                    <h2 id="prime-family-title" className="text-lg font-semibold text-fg">
                        Prime Family: share free shipping with your kids’ approved orders
                    </h2>
                    <p className="mt-1 text-sm text-fg-muted">
                        Add kid profiles in Family. Kids design and ask; when you approve, you check out as yourself, so your Prime benefits apply automatically: free standard shipping on orders from {threshold}, member material pricing, guaranteed dates and priority slots. Not a member? Family works without Prime too.
                    </p>
                    <Link href="/family" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-signal hover:underline" data-testid="prime-family-link">
                        Set up Family
                    </Link>
                </div>
            </div>
        </section>
    );
}
