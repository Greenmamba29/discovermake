/** Sign-in side effects: claiming guest builds and orders, roles from ADMIN_EMAILS / shops, preference merge, events. */
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { builds, devicePreferences, domainEvents, orders, shops, users } from '@/server/db/schema';
import { DEV_SHOP_ID } from '@/server/db/seed';
import { resetEnvCache } from '@/server/env';
import { completeSignIn } from '@/server/auth/users';
import { newBuildDisplayId } from '@/server/ids';
import { useTestDb } from '../support/db';
import { analyzedPart, placedOrder, useLocalStorage } from './fixtures';
import { newDevice } from './helpers';

describe('sign-in: claims, roles, preferences', () => {
    const ctx = useTestDb({ seed: true });
    useLocalStorage();
    afterEach(() => {
        delete process.env.ADMIN_EMAILS;
        resetEnvCache();
    });

    it("claims the device's guest builds and the email's guest orders (and legacy builds behind them)", async () => {
        const device = newDevice();
        const other = newDevice();
        const mine = await analyzedPart({ deviceHash: device.deviceHash });
        const otherDevice = await analyzedPart({ deviceHash: other.deviceHash });
        const legacy = await analyzedPart({});
        const email = 'claimer@example.com';
        const { orderId } = await placedOrder(ctx.db, legacy.partId, 'Claimer@Example.com');
        const { orderId: otherOrder } = await placedOrder(ctx.db, otherDevice.partId, 'someone-else@example.com');

        const r = await completeSignIn({ method: 'email', email, deviceHash: device.deviceHash });
        expect(r.created).toBe(true);
        expect(r.claimed).toEqual({ builds: 2, orders: 1 });

        const owner = async (id: string) => (await ctx.db.select().from(builds).where(eq(builds.id, id)))[0].ownerUserId;
        expect(await owner(mine.buildId)).toBe(r.viewer.id);
        expect(await owner(legacy.buildId)).toBe(r.viewer.id);
        expect(await owner(otherDevice.buildId)).toBeNull();
        expect((await ctx.db.select().from(orders).where(eq(orders.id, orderId)))[0].buyerUserId).toBe(r.viewer.id);
        expect((await ctx.db.select().from(orders).where(eq(orders.id, otherOrder)))[0].buyerUserId).toBeNull();

        const events = await ctx.db.select().from(domainEvents).where(eq(domainEvents.correlationId, r.viewer.id));
        expect(events.map((e) => e.eventType).sort()).toEqual(['user.created', 'user.signed_in']);
        expect(events.find((e) => e.eventType === 'user.signed_in')?.payload).toMatchObject({ claimedBuilds: 2, claimedOrders: 1, created: true, method: 'email' });
        const claimedEvents = await ctx.db.select().from(domainEvents).where(and(eq(domainEvents.eventType, 'build.claimed'), eq(domainEvents.buildId, mine.buildId)));
        expect(claimedEvents).toHaveLength(1);

        // A second sign-in claims nothing new and never steals another user's build.
        const again = await completeSignIn({ method: 'email', email, deviceHash: device.deviceHash });
        expect(again).toMatchObject({ created: false, claimed: { builds: 0, orders: 0 } });
        const intruder = await completeSignIn({ method: 'email', email: 'intruder@example.com', deviceHash: device.deviceHash });
        expect(intruder.claimed.builds).toBe(0);
        expect(await owner(mine.buildId)).toBe(r.viewer.id);
    });

    it('ADMIN_EMAILS grants ops + admin at sign-in (and removing the email revokes them)', async () => {
        process.env.ADMIN_EMAILS = ' Ops@DiscoverMake.com , boss@example.com';
        resetEnvCache();
        const r = await completeSignIn({ method: 'email', email: 'ops@discovermake.com', deviceHash: null });
        expect(r.viewer.roles).toEqual(['buyer', 'ops', 'admin']);
        const plain = await completeSignIn({ method: 'email', email: 'plain@example.com', deviceHash: null });
        expect(plain.viewer.roles).toEqual(['buyer']);

        delete process.env.ADMIN_EMAILS;
        resetEnvCache();
        expect((await completeSignIn({ method: 'email', email: 'ops@discovermake.com', deviceHash: null })).viewer.roles).toEqual(['buyer']);
    });

    it("grants shop to an active shop's contact email; keeps creator", async () => {
        const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, DEV_SHOP_ID));
        const r = await completeSignIn({ method: 'email', email: shop.contactEmail.toUpperCase(), deviceHash: null });
        expect(r.viewer.roles).toContain('shop');

        await ctx.db.update(users).set({ roles: ['buyer', 'creator'] }).where(eq(users.id, r.viewer.id));
        await ctx.db.update(shops).set({ status: 'SUSPENDED' }).where(eq(shops.id, DEV_SHOP_ID));
        const again = await completeSignIn({ method: 'email', email: shop.contactEmail, deviceHash: null });
        expect(again.viewer.roles).toEqual(['buyer', 'creator']);
        await ctx.db.update(shops).set({ status: 'ACTIVE' }).where(eq(shops.id, DEV_SHOP_ID));
    });

    it("merges the device's onboarding answers into an account that has none, and never overwrites", async () => {
        const device = newDevice();
        const onboardedAt = new Date('2026-09-01T00:00:00Z');
        await ctx.db.insert(devicePreferences).values({ deviceHash: device.deviceHash, intent: 'make', interests: ['robotics', 'drones'], onboardedAt });
        const r = await completeSignIn({ method: 'email', email: 'prefs@example.com', deviceHash: device.deviceHash });
        const [u] = await ctx.db.select().from(users).where(eq(users.id, r.viewer.id));
        expect(u).toMatchObject({ intent: 'make', interests: ['robotics', 'drones'] });
        expect(u.onboardedAt?.toISOString()).toBe(onboardedAt.toISOString());

        const device2 = newDevice();
        await ctx.db.insert(devicePreferences).values({ deviceHash: device2.deviceHash, intent: 'sell', interests: ['jewelry'] });
        await completeSignIn({ method: 'email', email: 'prefs@example.com', deviceHash: device2.deviceHash });
        const [after] = await ctx.db.select().from(users).where(eq(users.id, r.viewer.id));
        expect(after).toMatchObject({ intent: 'make', interests: ['robotics', 'drones'] });
    });

    it('emails are stored lowercased and unique', async () => {
        await completeSignIn({ method: 'email', email: 'MiXeD@Example.com', deviceHash: null });
        await completeSignIn({ method: 'email', email: 'mixed@example.com', deviceHash: null });
        expect(await ctx.db.select().from(users).where(eq(users.email, 'mixed@example.com'))).toHaveLength(1);
        await expect(ctx.db.insert(users).values({ email: 'UPPER@example.com' })).rejects.toThrow();
        await ctx.db.insert(builds).values({ displayId: newBuildDisplayId(), name: 'x' }); // owner columns are optional
    });
});
