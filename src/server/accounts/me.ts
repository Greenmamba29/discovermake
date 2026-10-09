/**
 * The "Me" API (ADR-0009): who am I, profile, onboarding preferences (guest or signed
 * in) and creator handles.
 */
import { eq } from 'drizzle-orm';
import type { MeResponse, Preferences, UpdatePreferencesRequest, UpdateProfileRequest, UserRole, Viewer } from '../../contracts/account';
import { getDb, type DbOrTx } from '../db';
import { devicePreferences, users } from '../db/schema';
import { ApiError } from '../http';
import { isUniqueViolation } from '../build-graph/builds';
import { enabledProviders } from '../auth/oidc';
import { listPasskeys } from '../auth/passkeys';
import { toViewer } from '../auth/users';

const EMPTY_PREFS: Preferences = { intent: null, interests: [] };

export async function devicePreferencesFor(deviceHash: string | null, db: DbOrTx = getDb()): Promise<Preferences> {
    if (!deviceHash) return EMPTY_PREFS;
    const [row] = await db.select().from(devicePreferences).where(eq(devicePreferences.deviceHash, deviceHash));
    return row ? { intent: row.intent ?? null, interests: row.interests ?? [] } : EMPTY_PREFS;
}

export async function getMe(principal: { userId: string | null; deviceHash: string | null }, db: DbOrTx = getDb()): Promise<MeResponse> {
    if (principal.userId) {
        const [user] = await db.select().from(users).where(eq(users.id, principal.userId));
        if (user) {
            return {
                viewer: toViewer(user),
                preferences: { intent: user.intent ?? null, interests: user.interests ?? [] },
                providers: enabledProviders(),
                passkeys: await listPasskeys(user.id, db),
            };
        }
    }
    return { viewer: null, preferences: await devicePreferencesFor(principal.deviceHash, db), providers: enabledProviders(), passkeys: [] };
}

/** Guest -> device_preferences; signed in -> users. `complete` stamps onboarded_at once. */
export async function updatePreferences(principal: { userId: string | null; deviceHash: string }, body: UpdatePreferencesRequest, db: DbOrTx = getDb()): Promise<Preferences> {
    const now = new Date();
    const patch: { intent?: Preferences['intent']; interests?: Preferences['interests'] } = {};
    if (body.intent !== undefined) patch.intent = body.intent;
    if (body.interests !== undefined) patch.interests = [...new Set(body.interests)];
    if (principal.userId) {
        const [current] = await db.select().from(users).where(eq(users.id, principal.userId));
        if (!current) throw new ApiError('UNAUTHORIZED', 'Sign in to continue.', 401);
        const [row] = await db
            .update(users)
            .set({ ...patch, ...(body.complete && !current.onboardedAt ? { onboardedAt: now } : {}) })
            .where(eq(users.id, principal.userId))
            .returning();
        return { intent: row.intent ?? null, interests: row.interests ?? [] };
    }
    const [row] = await db
        .insert(devicePreferences)
        .values({ deviceHash: principal.deviceHash, intent: patch.intent ?? null, interests: patch.interests ?? [], onboardedAt: body.complete ? now : null, updatedAt: now })
        .onConflictDoUpdate({
            target: devicePreferences.deviceHash,
            set: { ...patch, ...(body.complete ? { onboardedAt: now } : {}), updatedAt: now },
        })
        .returning();
    return { intent: row.intent ?? null, interests: row.interests ?? [] };
}

export async function updateProfile(userId: string, body: UpdateProfileRequest, db: DbOrTx = getDb()): Promise<Viewer> {
    const [current] = await db.select().from(users).where(eq(users.id, userId));
    if (!current) throw new ApiError('UNAUTHORIZED', 'Sign in to continue.', 401);
    const patch: Partial<typeof users.$inferInsert> = {};
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.handle !== undefined) patch.handle = body.handle;
    if (body.becomeCreator) {
        if (!(body.handle ?? current.handle)) throw new ApiError('VALIDATION_FAILED', 'Pick a handle to become a creator.', 400, { fieldErrors: { handle: ['Pick a handle to become a creator.'] } });
        if (!current.roles.includes('creator')) patch.roles = [...current.roles, 'creator'] as UserRole[];
    }
    if (!Object.keys(patch).length) return toViewer(current);
    try {
        const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
        return toViewer(row);
    } catch (err) {
        if (isUniqueViolation(err, 'users_handle_uq')) {
            throw new ApiError('CONFLICT', 'That handle is taken. Try another.', 409, { fieldErrors: { handle: ['That handle is taken. Try another.'] } });
        }
        throw err;
    }
}
