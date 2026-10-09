/**
 * Fixtures for Live suites: signed-in users via the accounts stub's test header, a creator
 * channel + show featuring a build with an orderable BINDING quote (tests/orders fixture).
 */
import type { Db } from '@/server/db';
import { getViewer, type ViewerContext } from '@/server/auth/viewer';
import { createShow, handleIntent, loadShowAccess, upsertChannel } from '@/server/live';
import { createQuoteFixture, type QuoteFixtureOptions } from '../orders/fixtures';

export const BASE = 'http://localhost:3100';

export type TestUser = { id: string; roles?: string; name?: string; email?: string };

export function userHeader(u: TestUser): string {
    return `id=${u.id};roles=${u.roles ?? 'buyer'};name=${encodeURIComponent(u.name ?? u.id)};email=${u.email ?? `${u.id}@example.com`}`;
}

export function req(path: string, opts: { method?: string; body?: unknown; user?: TestUser; headers?: Record<string, string>; signal?: AbortSignal } = {}): Request {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.user) headers['x-dm-test-user'] = userHeader(opts.user);
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
}

export async function viewerOf(u: TestUser): Promise<ViewerContext> {
    const v = await getViewer(req('/', { user: u }));
    if (!v) throw new Error('test viewer did not parse');
    return v;
}

let seq = 0;
export function uniqueUser(prefix: string, roles = 'buyer'): TestUser {
    seq++;
    return { id: `usr_${prefix}${Date.now().toString(36)}${seq}`, roles, name: `${prefix} ${seq}` };
}

export async function setupShow(db: Db, opts: { quote?: QuoteFixtureOptions; start?: boolean } = {}) {
    const host = uniqueUser('host', 'buyer,creator');
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
