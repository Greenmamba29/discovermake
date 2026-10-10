/**
 * Family setup for grown-ups: kid profiles and their controls, the grown-up PIN, Kids mode
 * hand-off and exit, the activity log. Every function takes the signed-in grown-up's user id and
 * only ever touches that family's rows.
 */
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import {
    CreateKidProfileRequest,
    defaultControlsFor,
    KID_MAX_PROFILES,
    UpdateKidProfileRequest,
    type FamilyActivityKind,
    type FamilyActivityView,
    type FamilyView,
    type KidAgeBand,
    type KidAvatar,
    type KidProfileView,
} from '@/contracts/kids';
import { KID_TEMPLATE_IDS, type KidTemplateId } from '@/contracts/text-to-cad';
import { getDb, withTx, type DbOrTx } from '../db';
import { env } from '../env';
import { families, familyActivity, kidDesigns, kidModeLocks, kidProfiles, kidRequests } from '../db/schema';
import { ApiError } from '../http';
import { newId } from '../ids';
import { getStorage } from '../storage';
import { getMembershipForBenefits } from '../prime/membership';
import { signKidCookie } from './cookie';
import { lockSession, unlockSession } from './lock';
import { hashPin, pinAttemptLimiter, verifyPin } from './pin';
import { logActivity } from './activity';
import { listFamilyRequests, purgeUnorderedKidBuild } from './requests';

type KidRow = typeof kidProfiles.$inferSelect;

const templateIds = (raw: unknown): KidTemplateId[] => (Array.isArray(raw) ? raw.filter((t): t is KidTemplateId => (KID_TEMPLATE_IDS as readonly string[]).includes(t as string)) : []);

export function toKidProfileView(row: KidRow, pendingRequests = 0): KidProfileView {
    return {
        id: row.id,
        nickname: row.nickname,
        ageBand: row.ageBand as KidAgeBand,
        avatar: row.avatar as KidAvatar,
        spendingLimitCents: row.spendingLimitCents,
        allowedTemplates: templateIds(row.allowedTemplates),
        liveViewing: row.liveViewing,
        discoverBrowsing: row.discoverBrowsing,
        pendingRequests,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function loadKid(ownerUserId: string, kidId: string, db: DbOrTx = getDb()): Promise<KidRow> {
    const [row] = await db
        .select()
        .from(kidProfiles)
        .where(and(eq(kidProfiles.id, kidId), eq(kidProfiles.ownerUserId, ownerUserId)))
        .limit(1);
    if (!row) throw new ApiError('NOT_FOUND', 'Kid profile not found');
    return row;
}

async function ensureFamily(db: DbOrTx, userId: string) {
    await db.insert(families).values({ userId }).onConflictDoNothing();
    // Serialise profile changes per family (the 4-profile cap).
    await db.execute(sql`select 1 from ${families} where ${families.userId} = ${userId} for update`);
}

export async function getFamilyRow(userId: string, db: DbOrTx = getDb()) {
    const [row] = await db.select().from(families).where(eq(families.userId, userId)).limit(1);
    return row ?? null;
}

export async function getFamilyView(userId: string): Promise<FamilyView> {
    const db = getDb();
    const [family, kids, pending, activity, requests, membership] = await Promise.all([
        getFamilyRow(userId),
        db.select().from(kidProfiles).where(eq(kidProfiles.ownerUserId, userId)).orderBy(asc(kidProfiles.createdAt)),
        db
            .select({ kidId: kidRequests.kidId, n: count() })
            .from(kidRequests)
            .where(and(eq(kidRequests.ownerUserId, userId), eq(kidRequests.status, 'pending')))
            .groupBy(kidRequests.kidId),
        db.select().from(familyActivity).where(eq(familyActivity.ownerUserId, userId)).orderBy(desc(familyActivity.createdAt)).limit(30),
        listFamilyRequests(userId),
        getMembershipForBenefits(userId),
    ]);
    const pendingBy = new Map(pending.map((p) => [p.kidId, Number(p.n)]));
    return {
        pinSet: Boolean(family?.pinHash),
        maxKids: KID_MAX_PROFILES,
        kids: kids.map((k) => toKidProfileView(k, pendingBy.get(k.id) ?? 0)),
        requests,
        activity: activity.map((a): FamilyActivityView => ({ id: a.id, kind: a.kind as FamilyActivityKind, summary: a.summary, createdAt: a.createdAt.toISOString() })),
        primeMember: Boolean(membership?.isMember),
        freeShippingThresholdCents: env().PRIME_FREE_SHIPPING_THRESHOLD_CENTS,
    };
}

export async function createKidProfile(userId: string, input: CreateKidProfileRequest): Promise<KidProfileView> {
    const req = CreateKidProfileRequest.parse(input);
    const defaults = defaultControlsFor(req.ageBand);
    return withTx(async (tx) => {
        await ensureFamily(tx, userId);
        const [{ n }] = await tx.select({ n: count() }).from(kidProfiles).where(eq(kidProfiles.ownerUserId, userId));
        if (Number(n) >= KID_MAX_PROFILES) throw new ApiError('CONFLICT', `A family can have up to ${KID_MAX_PROFILES} kid profiles.`, 409);
        const [row] = await tx
            .insert(kidProfiles)
            .values({
                id: newId('kidProfile'),
                ownerUserId: userId,
                nickname: req.nickname,
                ageBand: req.ageBand,
                avatar: req.avatar,
                spendingLimitCents: req.spendingLimitCents ?? defaults.spendingLimitCents,
                allowedTemplates: req.allowedTemplates ?? defaults.allowedTemplates,
                liveViewing: req.liveViewing ?? defaults.liveViewing,
                discoverBrowsing: req.discoverBrowsing ?? defaults.discoverBrowsing,
            })
            .returning();
        await logActivity(tx, userId, row!.id, 'kid_added', `Added ${req.nickname} (${req.ageBand})`);
        return toKidProfileView(row!);
    });
}

export async function updateKidProfile(userId: string, kidId: string, input: UpdateKidProfileRequest): Promise<KidProfileView> {
    const req = UpdateKidProfileRequest.parse(input);
    return withTx(async (tx) => {
        const kid = await loadKid(userId, kidId, tx);
        const patch: Partial<typeof kidProfiles.$inferInsert> = { updatedAt: new Date() };
        if (req.nickname !== undefined) patch.nickname = req.nickname;
        if (req.ageBand !== undefined) patch.ageBand = req.ageBand;
        if (req.avatar !== undefined) patch.avatar = req.avatar;
        if (req.spendingLimitCents !== undefined) patch.spendingLimitCents = req.spendingLimitCents;
        if (req.allowedTemplates !== undefined) patch.allowedTemplates = req.allowedTemplates;
        if (req.liveViewing !== undefined) patch.liveViewing = req.liveViewing;
        if (req.discoverBrowsing !== undefined) patch.discoverBrowsing = req.discoverBrowsing;
        const [row] = await tx.update(kidProfiles).set(patch).where(eq(kidProfiles.id, kid.id)).returning();
        await logActivity(tx, userId, kid.id, 'kid_updated', `Changed ${row!.nickname}’s settings`);
        return toKidProfileView(row!);
    });
}

/**
 * One tap: the profile and everything about it (designs, requests, activity, Kids mode locks).
 * Designs the grown-up never ordered also lose their build, part, quotes and files. Paid orders
 * stay: they are the grown-up's own purchase records (tax, warranty), and carry no kid data
 * beyond the printed object itself.
 */
export async function deleteKidProfile(userId: string, kidId: string): Promise<{ deleted: true }> {
    const kid = await loadKid(userId, kidId);
    const designs = await getDb()
        .select({ id: kidDesigns.id, buildId: kidDesigns.buildId, cad: kidDesigns.cad })
        .from(kidDesigns)
        .where(eq(kidDesigns.kidId, kid.id));
    await withTx(async (tx) => {
        await ensureFamily(tx, userId);
        await tx.delete(kidModeLocks).where(eq(kidModeLocks.kidId, kid.id));
        await tx.delete(kidRequests).where(eq(kidRequests.kidId, kid.id));
        await tx.delete(kidDesigns).where(eq(kidDesigns.kidId, kid.id));
        await tx.delete(familyActivity).where(eq(familyActivity.kidId, kid.id));
        await tx.delete(kidProfiles).where(eq(kidProfiles.id, kid.id));
        await logActivity(tx, userId, null, 'kid_removed', 'Removed a kid profile and all of its designs and requests');
    });
    const storage = getStorage();
    for (const d of designs) {
        for (const a of d.cad?.artifacts ?? []) await storage.deleteObject(a.key).catch(() => undefined);
        if (d.buildId) await purgeUnorderedKidBuild(d.buildId);
    }
    return { deleted: true };
}

export async function setFamilyPin(userId: string, pin: string): Promise<{ pinSet: true }> {
    const pinHash = await hashPin(pin);
    await withTx(async (tx) => {
        await ensureFamily(tx, userId);
        await tx.update(families).set({ pinHash, pinSetAt: new Date(), updatedAt: new Date() }).where(eq(families.userId, userId));
        await logActivity(tx, userId, null, 'pin_set', 'Set the grown-up PIN');
    });
    return { pinSet: true };
}

/** "Hand to <kid>": lock the grown-up's session to the kid and return the signed Kids mode cookie. */
export async function handOffToKid(viewer: { userId: string; sessionId: string }, kidId: string): Promise<{ cookie: string; url: string }> {
    const kid = await loadKid(viewer.userId, kidId);
    const family = await getFamilyRow(viewer.userId);
    if (!family?.pinHash) throw new ApiError('CONFLICT', 'Set a grown-up PIN first: you need it to leave Kids mode.', 409);
    await withTx(async (tx) => {
        await lockSession({ sessionId: viewer.sessionId, ownerUserId: viewer.userId, kidId: kid.id }, tx);
        await logActivity(tx, viewer.userId, kid.id, 'kids_mode_started', `Kids mode started for ${kid.nickname}`);
    });
    return { cookie: signKidCookie({ k: kid.id, o: viewer.userId, s: viewer.sessionId }), url: '/kids' };
}

export type ExitResult = { ok: true } | { ok: false; reason: 'wrong_pin' | 'rate_limited'; retryAfterSeconds?: number };

/**
 * Leave Kids mode. Needs the grown-up PIN of the family that started it (from the session lock,
 * else the signed cookie). With neither (no lock, unreadable cookie) there is nothing to protect.
 */
export async function exitKidsMode(input: { ownerUserId: string | null; sessionId: string | null; kidId: string | null }, pin: string): Promise<ExitResult> {
    if (input.ownerUserId) {
        const decision = await pinAttemptLimiter.hit(`owner:${input.ownerUserId}`);
        if (!decision.allowed) return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
        const family = await getFamilyRow(input.ownerUserId);
        if (family?.pinHash && !(await verifyPin(pin, family.pinHash))) return { ok: false, reason: 'wrong_pin' };
    }
    await withTx(async (tx) => {
        if (input.sessionId) await unlockSession(input.sessionId, tx);
        if (input.ownerUserId) {
            const kid = input.kidId ? (await tx.select({ id: kidProfiles.id, nickname: kidProfiles.nickname }).from(kidProfiles).where(and(eq(kidProfiles.id, input.kidId), eq(kidProfiles.ownerUserId, input.ownerUserId))))[0] : undefined;
            await logActivity(tx, input.ownerUserId, kid?.id ?? null, 'kids_mode_ended', kid ? `Kids mode ended for ${kid.nickname}` : 'Kids mode ended');
        }
    });
    return { ok: true };
}
