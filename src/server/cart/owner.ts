/**
 * Who owns the cart for a request: the signed-in user (by id), else this browser's
 * device (`dm_device`, via the accounts module's device helpers).
 */
import type { NextResponse } from 'next/server';
import { applyDevice, getDeviceHash, getViewer, resolveDevice, type ViewerContext } from '../auth/viewer';
import { mergeGuestCart } from './cart';

export type CartOwner = { userId: string | null; deviceHash: string | null };

export type ResolvedCartOwner = {
    owner: CartOwner;
    viewer: ViewerContext | null;
    /** Persist a newly minted device cookie on the response (no-op when the browser had one). */
    apply: (response: NextResponse) => void;
};

/**
 * Resolve the cart owner. Signed in: merges this device's guest cart into the user's cart
 * first (sign-in merge; idempotent). `mint`: create a device cookie for guests without one
 * (adding to the cart); otherwise a guest without a cookie simply has no cart yet.
 */
export async function resolveCartOwner(request: Request, opts: { mint?: boolean } = {}): Promise<ResolvedCartOwner> {
    const viewer = await getViewer(request);
    const existing = getDeviceHash(request);
    if (viewer && existing) await mergeGuestCart(viewer.user.id, existing);
    if (viewer) return { owner: { userId: viewer.user.id, deviceHash: null }, viewer, apply: () => undefined };
    if (!existing && opts.mint) {
        const device = resolveDevice(request);
        return { owner: { userId: null, deviceHash: device.hash }, viewer: null, apply: (response) => applyDevice(response, device) };
    }
    return { owner: { userId: null, deviceHash: existing }, viewer: null, apply: () => undefined };
}
