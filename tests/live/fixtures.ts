/**
 * Fixtures for Live suites: real signed-in users (accounts module: completeSignIn + a
 * session cookie), a creator channel + show featuring a build with an orderable BINDING
 * quote (tests/orders fixture).
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DEVICE_COOKIE, SESSION_COOKIE, type UserRole } from '@/contracts/account';
import type { Db } from '@/server/db';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { hashDeviceSecret } from '@/server/auth/device';
import { completeSignIn } from '@/server/auth/users';
import { getViewer, type ViewerContext } from '@/server/auth/viewer';
import { createShow, handleIntent, loadShowAccess, upsertChannel } from '@/server/live';
import { createQuoteFixture, type QuoteFixtureOptions } from '../orders/fixtures';

export const BASE = 'http://localhost:3100';

export type TestUser = { id: string; email: string; session: string; device: string };

let seq = 0;

/** A user signed in by verified email, with the given roles and display name. */
export async function makeUser(prefix: string, roles: UserRole[] = ['buyer'], name?: string): Promise<TestUser> {
    seq++;
    const device = randomBytes(24).toString('base64url');
    const email = `${prefix}-${Date.now().toString(36)}-${seq}-${randomBytes(3).toString('hex')}@example.com`;
    const r = await completeSignIn({ method: 'email', email, deviceHash: hashDeviceSecret(device) });
    await getDb()
        .update(users)
        .set({ roles: [...new Set<UserRole>(['buyer', ...roles])], displayName: name ?? `${prefix} ${seq}` })
        .where(eq(users.id, r.viewer.id));
    return { id: r.viewer.id, email, session: r.session.secret, device };
}

export function req(path: string, opts: { method?: string; body?: unknown; user?: TestUser; headers?: Record<string, string>; signal?: AbortSignal } = {}): Request {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.user) headers.cookie = `${DEVICE_COOKIE}=${opts.user.device}; ${SESSION_COOKIE}=${opts.user.session}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
}

export async function viewerOf(u: TestUser): Promise<ViewerContext> {
    const v = await getViewer(req('/', { user: u }));
    if (!v) throw new Error('test viewer has no session');
    return v;
}

export async function setupShow(db: Db, opts: { quote?: QuoteFixtureOptions; start?: boolean } = {}) {
    const host = await makeUser('host', ['buyer', 'creator'], 'Amanda');
    const hostCtx = await viewerOf(host);
    const fixture = await createQuoteFixture(db, { quantity: 10, unitPriceCents: 500, ...(opts.quote ?? {}) });
    const channel = await upsertChannel(hostCtx, { name: `Workshop ${seq}`, handle: `ws_${Date.now().toString(36)}${seq}`.slice(0, 24), kind: 'creator', categories: ['workshop'] });
    const show = await createShow(hostCtx, { title: 'Bracket build night', format: 'live_drop', scheduledFor: new Date().toISOString(), featuredBuildIds: [fixture.build.id] });
    const hostAccess = async () => loadShowAccess(req('/', { user: host }), show.id);
    if (opts.start !== false) await handleIntent(await hostAccess(), { intent: 'start_show' });
    return { host, hostCtx, channel, show, fixture, hostAccess };
}

export const SHIP_TO = { name: 'Ada Maker', line1: '100 Market St', city: 'Philadelphia', region: 'PA', postalCode: '19106', country: 'US' as const };

export function claimBody(quantity: number) {
    return { quantity, buyer: { name: 'Ada Maker' }, shippingAddress: SHIP_TO, shippingMethod: 'STANDARD' as const, acceptTerms: true as const };
}
