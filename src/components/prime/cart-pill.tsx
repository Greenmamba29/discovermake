'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { CartView } from '@/contracts/prime';
import { bottomNavVisible } from '@/components/site/nav-items';
import { money, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CART_CHANGED_EVENT, primeApi } from './api';

/** Screens that own the bottom edge or are the cart itself: no pill there. */
const HIDDEN = ['/cart', '/checkout', '/parts', '/admin', '/onboarding', '/shop', '/signin'];

function hiddenOn(pathname: string) {
    return HIDDEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Floating build-cart pill (DoorDash "Subway · $11.38 total · 1"): count + total, visible on
 * app pages while the cart has items. Sits above the mobile bottom nav; bottom-right on desktop.
 * Mounted once in the app layout; refreshes on navigation and on `dm:cart-changed`.
 */
export function CartPill() {
    const pathname = usePathname() ?? '/';
    const [cart, setCart] = useState<CartView | null>(null);

    useEffect(() => {
        let alive = true;
        if (hiddenOn(pathname)) return;
        primeApi
            .cart()
            .then((c) => alive && setCart(c))
            .catch(() => alive && setCart(null));
        return () => {
            alive = false;
        };
    }, [pathname]);

    useEffect(() => {
        const onChange = (e: Event) => {
            const detail = (e as CustomEvent<CartView | undefined>).detail;
            if (detail) setCart(detail);
            else primeApi.cart().then(setCart).catch(() => setCart(null));
        };
        window.addEventListener(CART_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(CART_CHANGED_EVENT, onChange);
    }, []);

    if (hiddenOn(pathname) || !cart || cart.count === 0) return null;
    const aboveNav = bottomNavVisible(pathname);
    return (
        <div
            className={cn(
                'pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 md:inset-x-auto md:bottom-6 md:right-6 md:justify-end md:px-0',
                aboveNav ? 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]',
            )}
        >
            <Link
                href="/cart"
                className="pointer-events-auto flex h-12 w-full max-w-sm items-center gap-3 rounded-full bg-signal px-4 text-signal-ink shadow-lg shadow-black/40 transition-transform hover:scale-[1.01] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:w-auto"
                data-testid="cart-pill"
                aria-label={`Build cart: ${plural(cart.count, 'part')}, ${money(cart.subtotalCents, cart.currency)}`}
            >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-signal-ink/15" aria-hidden>
                    <ShoppingBag className="h-4 w-4" />
                </span>
                <span className="flex-1 text-sm font-bold">View build cart</span>
                <span className="font-mono text-sm font-semibold tabular" data-testid="cart-pill-total">
                    {money(cart.subtotalCents, cart.currency)}
                </span>
                <span className="rounded-full bg-signal-ink px-2 py-0.5 font-mono text-xs font-bold text-signal" data-testid="cart-pill-count">
                    {cart.count}
                </span>
            </Link>
        </div>
    );
}
