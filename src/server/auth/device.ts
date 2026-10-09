/**
 * Guest device identity (ADR-0009). Every browser gets an opaque `dm_device` cookie:
 * 192 random bits, HttpOnly, SameSite=Lax, Secure in production, 1 year. The server
 * stores only sha256(cookie), so a database leak cannot be replayed as a device.
 */
import type { NextResponse } from 'next/server';
import { DEVICE_COOKIE } from '../../contracts/account';
import { baseCookieOptions, readRequestCookie, setCookie } from './cookies';
import { generateToken, sha256Hex } from './tokens';

export const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const DEVICE_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function hashDeviceSecret(secret: string): string {
    return sha256Hex(`dm_device.${secret}`);
}

/** A well-formed device cookie value from the request, or null. */
export function readDeviceSecret(request: Request): string | null {
    const raw = readRequestCookie(request, DEVICE_COOKIE);
    return raw && DEVICE_RE.test(raw) ? raw : null;
}

/** sha256 of the request's device cookie, or null when the browser has none yet. */
export function getDeviceHash(request: Request): string | null {
    const secret = readDeviceSecret(request);
    return secret ? hashDeviceSecret(secret) : null;
}

export type DeviceHandle = { hash: string; secret: string; isNew: boolean };

/** The request's device, or a freshly minted one (call `applyDevice` on the response to persist it). */
export function resolveDevice(request: Request): DeviceHandle {
    const existing = readDeviceSecret(request);
    if (existing) return { hash: hashDeviceSecret(existing), secret: existing, isNew: false };
    const secret = generateToken(undefined, 24); // 192 bits -> 32 base64url chars
    return { hash: hashDeviceSecret(secret), secret, isNew: true };
}

/** Set the device cookie on `response` when the device was minted for this request. */
export function applyDevice(response: NextResponse, device: DeviceHandle): void {
    if (!device.isNew) return;
    setCookie(response, DEVICE_COOKIE, device.secret, baseCookieOptions({ maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS }));
}

/**
 * Ensure the browser has a device cookie: returns its hash and, when the request had
 * none, sets a new one on `response`.
 */
export function ensureDevice(request: Request, response: NextResponse): string {
    const device = resolveDevice(request);
    applyDevice(response, device);
    return device.hash;
}
