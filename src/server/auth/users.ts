/**
 * Users, roles and the shared sign-in completion step (ADR-0009).
 *
 * Every sign-in method (email code, passkey, Google, Apple) ends in `completeSignIn`:
 *   1. roles are recomputed (ADMIN_EMAILS -> ops + admin; shop contact email -> shop),
 *   2. the device's guest builds and the email's guest orders are claimed,
 *   3. guest onboarding preferences are merged when the user has none,
 *   4. a session is created,
 * with `user.created` / `user.signed_in` / `build.claimed` events in the same transaction.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthProvider, UserRole, Viewer } from '../../contracts/account';
import type { Actor } from '../../contracts/common';
import { getDb, type DbOrTx, type Tx } from '../db';
import { builds, devicePreferences, orders, shops, users } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { createSession, type CreatedSession } from './sessions';

export type UserRow = typeof users.$inferSelect;

export const userActor = (userId: string): Actor => ({ kind: 'buyer', id: userId });

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function toViewer(row: UserRow): Viewer {
    return {
        id: row.id,
        email: row.email,
        emailVerified: row.emailVerifiedAt !== null,
        displayName: row.displayName,
        handle: row.handle,
        roles: row.roles.length ? row.roles : ['buyer'],
        onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
    };
}

/** Lowercased ADMIN_EMAILS entries. */
export function adminEmails(): Set<string> {
    const raw = env().ADMIN_EMAILS ?? '';
    return new Set(
        raw
            .split(',')
            .map((e) => normalizeEmail(e))
            .filter(Boolean),
    );
}

const ROLE_ORDER: UserRole[] = ['buyer', 'creator', 'shop', 'ops', 'admin'];

/**
 * Roles for a user at sign-in. `buyer` always; `creator` is kept (self-service);
 * `ops` + `admin` exactly when the email is in ADMIN_EMAILS; `shop` exactly when the
 * email is an ACTIVE shop's contact email (the only shop/email link that exists today;
 * per-user shop memberships replace this later).
 */
export async function computeRoles(email: string, current: readonly UserRole[], db: DbOrTx = getDb()): Promise<UserRole[]> {
    const roles = new Set<UserRole>(['buyer']);
    if (current.includes('creator')) roles.add('creator');
    if (adminEmails().has(normalizeEmail(email))) {
        roles.add('ops');
        roles.add('admin');
    }
    const [shop] = await db
        .select({ id: shops.id })
        .from(shops)
        .where(and(sql`lower(${shops.contactEmail}) = ${normalizeEmail(email)}`, eq(shops.status, 'ACTIVE')))
        .limit(1);
    if (shop) roles.add('shop');
    return ROLE_ORDER.filter((r) => roles.has(r));
}

export type SignInInput = {
    method: AuthProvider;
    /** Verified email (email code / OIDC). Passkey sign-ins pass `userId` instead. */
    email?: string;
    userId?: string;
    deviceHash: string | null;
    userAgent?: string | null;
    /** Extra work inside the sign-in transaction (e.g. linking an OIDC account). */
    onUser?: (tx: Tx, user: UserRow) => Promise<void>;
};

export type SignInResult = {
    viewer: Viewer;
    created: boolean;
    claimed: { builds: number; orders: number };
    session: CreatedSession;
};

/** Find-or-create the user, recompute roles, claim guest state, merge preferences and open a session. */
export async function completeSignIn(input: SignInInput, db: DbOrTx = getDb()): Promise<SignInResult> {
    return db.transaction(async (tx) => {
        const now = new Date();
        let user: UserRow | undefined;
        let created = false;
        if (input.userId) {
            [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
            if (!user) throw new ApiError('UNAUTHORIZED', 'This account no longer exists.', 401);
        } else if (input.email) {
            const email = normalizeEmail(input.email);
            const inserted = await tx.insert(users).values({ email, emailVerifiedAt: now }).onConflictDoNothing({ target: users.email }).returning({ id: users.id });
            created = inserted.length > 0;
            [user] = await tx.select().from(users).where(eq(users.email, email)).for('update');
        } else {
            throw new Error('completeSignIn needs an email or a userId');
        }
        if (!user) throw new ApiError('INTERNAL', 'Could not load the account', 500);

        const roles = await computeRoles(user.email, user.roles, tx);
        const patch: Partial<UserRow> = { roles };
        if (input.email && !user.emailVerifiedAt) patch.emailVerifiedAt = now;

        // Guest onboarding answers become the account's when it has none of its own.
        if (input.deviceHash && !user.intent && user.interests.length === 0 && !user.onboardedAt) {
            const [prefs] = await tx.select().from(devicePreferences).where(eq(devicePreferences.deviceHash, input.deviceHash));
            if (prefs) Object.assign(patch, { intent: prefs.intent, interests: prefs.interests, onboardedAt: prefs.onboardedAt });
        }
        [user] = await tx.update(users).set(patch).where(eq(users.id, user.id)).returning();

        if (input.onUser) await input.onUser(tx, user);
        const claimed = await claimGuestState(tx, user, input.deviceHash);
        const session = await createSession(user.id, { deviceHash: input.deviceHash, userAgent: input.userAgent, now, db: tx });

        const actor = userActor(user.id);
        if (created) await emitEvent(tx, { type: 'user.created', payload: { userId: user.id, method: input.method }, actor, correlationId: user.id });
        await emitEvent(tx, {
            type: 'user.signed_in',
            payload: { userId: user.id, method: input.method, created, claimedBuilds: claimed.builds, claimedOrders: claimed.orders },
            actor,
            correlationId: user.id,
        });
        return { viewer: toViewer(user), created, claimed, session };
    });
}

/**
 * Claim guest state for a signed-in user:
 * - builds of this device with no owner,
 * - orders whose buyer email equals the verified email and that have no buyer yet,
 * - legacy builds (no owner, no device) behind those orders.
 * Returns how many builds and orders were attached.
 */
export async function claimGuestState(tx: DbOrTx, user: Pick<UserRow, 'id' | 'email' | 'emailVerifiedAt'>, deviceHash: string | null): Promise<{ builds: number; orders: number }> {
    const actor = userActor(user.id);
    const claimedBuildIds = new Set<string>();
    if (deviceHash) {
        const rows = await tx
            .update(builds)
            .set({ ownerUserId: user.id, updatedAt: new Date() })
            .where(and(isNull(builds.ownerUserId), eq(builds.deviceHash, deviceHash)))
            .returning({ id: builds.id });
        rows.forEach((r) => claimedBuildIds.add(r.id));
    }
    let orderCount = 0;
    if (user.emailVerifiedAt) {
        const claimedOrders = await tx
            .update(orders)
            .set({ buyerUserId: user.id })
            .where(and(isNull(orders.buyerUserId), sql`lower(${orders.buyerEmail}) = ${normalizeEmail(user.email)}`))
            .returning({ id: orders.id, buildId: orders.buildId });
        orderCount = claimedOrders.length;
        const orderBuildIds = [...new Set(claimedOrders.map((o) => o.buildId))];
        if (orderBuildIds.length) {
            const legacy = await tx
                .update(builds)
                .set({ ownerUserId: user.id, updatedAt: new Date() })
                .where(and(inArray(builds.id, orderBuildIds), isNull(builds.ownerUserId), isNull(builds.deviceHash)))
                .returning({ id: builds.id });
            legacy.forEach((r) => claimedBuildIds.add(r.id));
        }
    }
    for (const buildId of claimedBuildIds) {
        await emitEvent(tx, { type: 'build.claimed', payload: { buildId, userId: user.id }, actor, correlationId: buildId, buildId });
    }
    return { builds: claimedBuildIds.size, orders: orderCount };
}

export async function getUserById(userId: string, db: DbOrTx = getDb()): Promise<UserRow | null> {
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    return row ?? null;
}
