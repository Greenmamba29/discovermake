/**
 * Ops access: ADMIN_TOKEN and CRON_SECRET keep working unchanged; a signed-in ops/admin
 * user is accepted too (same-origin only); everyone else gets 401. Also a static check
 * that every guard call under src/app/api is awaited (the guards are async).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { createSession } from '@/server/auth/sessions';
import { completeSignIn } from '@/server/auth/users';
import { GET as adminOrders } from '@/app/api/admin/orders/route';
import { POST as outboxPublish } from '@/app/api/admin/outbox/publish/route';
import { useTestDb } from '../support/db';
import { newDevice, params, req, signedInUser, type Principal } from './helpers';

function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        return statSync(p).isDirectory() ? routeFiles(p) : p.endsWith('.ts') ? [p] : [];
    });
}

describe('admin guards', () => {
    const ctx = useTestDb();
    beforeAll(() => {
        process.env.ADMIN_EMAILS = 'chief@discovermake.com';
        resetEnvCache();
    });
    afterAll(() => {
        delete process.env.ADMIN_EMAILS;
        resetEnvCache();
    });

    it('every requireAdmin / requireAdminOrCron call in a route is awaited', () => {
        const offenders: string[] = [];
        for (const file of routeFiles(path.resolve('src/app/api'))) {
            readFileSync(file, 'utf8')
                .split('\n')
                .forEach((line, i) => {
                    if (/\brequireAdmin(OrCron)?\(/.test(line) && !/^\s*import\b/.test(line) && !/\bawait\s+requireAdmin(OrCron)?\(/.test(line)) offenders.push(`${file}:${i + 1}`);
                });
        }
        expect(offenders).toEqual([]);
    });

    it('accepts ADMIN_TOKEN and an ops session; refuses buyers, wrong tokens and cross-origin cookie requests', async () => {
        const token = await adminOrders(req('GET', '/api/admin/orders', null, undefined, { authorization: 'Bearer test-admin-token' }), params({}));
        expect(token.status).toBe(200);

        const chief = await completeSignIn({ method: 'email', email: 'chief@discovermake.com', deviceHash: null });
        expect(chief.viewer.roles).toEqual(['buyer', 'ops', 'admin']);
        const ops: Principal = { ...newDevice(), session: chief.session.secret };
        expect((await adminOrders(req('GET', '/api/admin/orders', ops), params({}))).status).toBe(200);
        expect((await adminOrders(req('GET', '/api/admin/orders', ops, undefined, { origin: 'https://evil.example' }), params({}))).status).toBe(403);
        // A wrong bearer never falls back to the cookie.
        expect((await adminOrders(req('GET', '/api/admin/orders', ops, undefined, { authorization: 'Bearer nope' }), params({}))).status).toBe(401);

        const [opsOnly] = await ctx.db.insert(users).values({ email: 'ops-only@example.com', roles: ['buyer', 'ops'] }).returning();
        const opsSession: Principal = { ...newDevice(), session: (await createSession(opsOnly.id)).secret };
        expect((await adminOrders(req('GET', '/api/admin/orders', opsSession), params({}))).status).toBe(200);

        const buyer = await signedInUser();
        expect((await adminOrders(req('GET', '/api/admin/orders', buyer), params({}))).status).toBe(401);
        expect((await adminOrders(req('GET', '/api/admin/orders', null), params({}))).status).toBe(401);
        expect((await adminOrders(req('GET', '/api/admin/orders', null, undefined, { authorization: 'Bearer wrong' }), params({}))).status).toBe(401);
    });

    it('cron routes: CRON_SECRET, ADMIN_TOKEN or an ops session; nothing else', async () => {
        expect((await outboxPublish(req('POST', '/api/admin/outbox/publish', null, undefined, { authorization: 'Bearer test-cron-secret' }), params({}))).status).toBe(200);
        expect((await outboxPublish(req('POST', '/api/admin/outbox/publish', null, undefined, { authorization: 'Bearer test-admin-token' }), params({}))).status).toBe(200);
        expect((await outboxPublish(req('POST', '/api/admin/outbox/publish', await signedInUser()), params({}))).status).toBe(401);
        // The cron secret opens nothing else.
        expect((await adminOrders(req('GET', '/api/admin/orders', null, undefined, { authorization: 'Bearer test-cron-secret' }), params({}))).status).toBe(401);
    });
});
