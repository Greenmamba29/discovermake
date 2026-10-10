/**
 * Publishing + remix licences (workflow 08 "Publishing workflow" / "Remix licensing").
 *
 *   publishBuild        the signed-in build owner sets visibility, licence, royalty %, tags, cover
 *   makeFromBuild       Make This (clone) / Remix, licence enforced; copies the flat pattern so the
 *                       new build can be quoted and ordered (its orders pay the parent's royalty)
 *   assertCanFork       licence gate shared with the R2 `/remix` and `/clone` routes
 *   publicBuildView     `/b/:buildId` (public, or the owner's own private build)
 *
 * Licence rules (V1):
 *   - A build with no publication row keeps the R2 behaviour (anyone with its id may fork it).
 *   - A published build that is private again answers 404 to everyone but its owner.
 *   - `none`: Make This (clone) only. `personal` / `commercial`: remix too.
 *   - A remix / clone may be published publicly only when its direct parent is licensed
 *     `commercial` (or the publisher owns the parent). Personal remixes stay private.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { INTEREST_SLUGS, type InterestSlug } from '../../contracts/account';
import type { Actor } from '../../contracts/common';
import {
    LICENSE_TEXT,
    type MakeFromBuildResponse,
    type PublicBuildView,
    type PublicationView,
    type PublishBuildRequest,
    type RemixLicense,
    type RemixNode,
    type StudioPublicationsResponse,
} from '../../contracts/media';
import { isStaff, type BuildOwner, type ViewerContext } from '../auth/viewer';
import { forkBuild, latestApprovedVersionRow, withDisplayId } from '../build-graph';
import { getDb, withTx, type DbOrTx } from '../db';
import { buildAttachments, buildPublications, builds, orders, parts } from '../db/schema';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { newId } from '../ids';
import { analyzePart, uploadPartBytes } from '../quote';
import { RateLimiter } from '../rate-limit';
import { getStorage, storageKeys } from '../storage';
import { buildCards, creatorName, loadBuildCommerce, loadCreatorRefs, loadPublication, publicationView, type PublicationRow } from './cards';

type BuildRow = typeof builds.$inferSelect;

/** Shared limiter (src/server/rate-limit): publish / unpublish writes per user. */
export const publishLimiter = new RateLimiter('media_publish', { kind: 'fixed_window', limit: 20, windowMs: 60_000 });
/** Make This / Remix from published builds, per user or device. */
export const makeLimiter = new RateLimiter('media_make', { kind: 'fixed_window', limit: 20, windowMs: 60_000 });

const INTEREST_SET = new Set<string>(INTEREST_SLUGS);

function interestsFromTags(tags: string[]): InterestSlug[] {
    return [...new Set(tags.filter((t) => INTEREST_SET.has(t)))] as InterestSlug[];
}

async function loadBuildRow(buildId: string, db: DbOrTx = getDb()): Promise<BuildRow | null> {
    const [row] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
    return row ?? null;
}

function ownsBuild(viewer: ViewerContext | null, build: Pick<BuildRow, 'ownerUserId'>): boolean {
    return !!viewer && (isStaff(viewer) || (!!build.ownerUserId && build.ownerUserId === viewer.user.id));
}

/**
 * Can `ownerUserId` publish this (derived) build publicly? Returns null when allowed,
 * else the plain-language reason.
 */
export async function publishBlockedReason(build: Pick<BuildRow, 'derivedFromBuildId' | 'origin'>, ownerUserId: string, db: DbOrTx = getDb()): Promise<string | null> {
    if (!build.derivedFromBuildId) return null;
    const parent = await loadBuildRow(build.derivedFromBuildId, db);
    if (!parent) return null;
    if (parent.ownerUserId === ownerUserId) return null;
    const pub = await loadPublication(parent.id, db);
    if (!pub) return parent.ownerUserId ? 'This build is a copy of someone else’s private design, so it cannot be published.' : null;
    if (pub.license === 'commercial') return null;
    return pub.license === 'personal'
        ? 'The original is licensed for personal remixes only: you can order this remix, but not publish or sell it.'
        : 'The original is all rights reserved: you can order this copy, but not publish or sell it.';
}

export async function publishBuild(viewer: ViewerContext, buildId: string, input: PublishBuildRequest): Promise<PublicationView> {
    const db = getDb();
    const build = await loadBuildRow(buildId, db);
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    if (!build.ownerUserId) throw new ApiError('FORBIDDEN', 'Save this build to your account (sign in on the device that made it) before publishing it.', 403);
    if (!ownsBuild(viewer, build)) throw new ApiError('FORBIDDEN', 'Only the owner of this build can publish it.', 403);
    // Kids & Family: a kid's design (and the words on it) is never shown publicly.
    if (build.origin === 'kids') throw new ApiError('FORBIDDEN', 'Kids projects stay private to your family and cannot be published.', 403, { reason: 'KIDS' });
    const ownerUserId = build.ownerUserId;
    if (input.visibility === 'public') {
        const blocked = await publishBlockedReason(build, ownerUserId, db);
        if (blocked) throw new ApiError('FORBIDDEN', blocked, 403, { reason: 'LICENSE' });
    }
    if (input.coverAttachmentId) {
        const [att] = await db
            .select({ id: buildAttachments.id, kind: buildAttachments.kind, sha256: buildAttachments.sha256 })
            .from(buildAttachments)
            .where(and(eq(buildAttachments.id, input.coverAttachmentId), eq(buildAttachments.buildId, buildId), isNull(buildAttachments.deletedAt)));
        if (!att || att.kind !== 'image' || !att.sha256) throw new ApiError('VALIDATION_FAILED', 'Pick a verified image attachment of this build as the cover.');
    }
    const existing = await loadPublication(buildId, db);
    const creators = await loadCreatorRefs([ownerUserId], db);
    const creator = creators.get(ownerUserId);
    const title = input.title ?? existing?.title ?? build.name;
    const description = input.description ?? existing?.description ?? null;
    const tags = [...new Set(input.tags)];
    const now = new Date();
    const searchText = [title, description ?? '', tags.join(' '), build.displayId, creator?.displayName ?? '', creator?.handle ?? '', creator?.channelName ?? ''].join(' ').slice(0, 4000);
    const fields = {
        ownerUserId,
        visibility: input.visibility,
        license: input.license,
        royaltyPct: input.royaltyPct,
        title,
        description,
        tags,
        interests: interestsFromTags(tags),
        coverAttachmentId: input.coverAttachmentId === undefined ? (existing?.coverAttachmentId ?? null) : input.coverAttachmentId,
        searchText,
        publishedAt: existing?.publishedAt ?? (input.visibility === 'public' ? now : null),
        updatedAt: now,
    };
    const row = await withTx(async (tx) => {
        const [saved] = await tx
            .insert(buildPublications)
            .values({ buildId, ...fields })
            .onConflictDoUpdate({ target: buildPublications.buildId, set: fields })
            .returning();
        await emitEvent(tx, {
            type: 'build.published',
            payload: { buildId, visibility: saved.visibility, license: saved.license, royaltyPct: saved.royaltyPct },
            actor: { kind: 'buyer', id: viewer.user.id },
            correlationId: buildId,
            buildId,
        });
        return saved;
    });
    return publicationView(row, db);
}

/** The signed-in creator's own builds with their publication state (Creator Studio · Publishing). */
export async function studioPublications(viewer: ViewerContext): Promise<StudioPublicationsResponse> {
    const db = getDb();
    const rows = await db.select().from(builds).where(eq(builds.ownerUserId, viewer.user.id)).orderBy(sql`${builds.updatedAt} desc`).limit(60);
    if (!rows.length) return { rows: [] };
    const ids = rows.map((r) => r.id);
    const [pubs, images, commerce] = await Promise.all([
        db.select().from(buildPublications).where(inArray(buildPublications.buildId, ids)),
        db
            .select({ id: buildAttachments.id, buildId: buildAttachments.buildId, filename: buildAttachments.filename, sha256: buildAttachments.sha256 })
            .from(buildAttachments)
            .where(and(inArray(buildAttachments.buildId, ids), eq(buildAttachments.kind, 'image'), isNull(buildAttachments.deletedAt))),
        loadBuildCommerce(ids, db),
    ]);
    const pubBy = new Map(pubs.map((p) => [p.buildId, p]));
    const out: StudioPublicationsResponse['rows'] = [];
    for (const b of rows) {
        const pub = pubBy.get(b.id);
        const reason = await publishBlockedReason(b, viewer.user.id, db);
        const preview = commerce.get(b.id)?.part?.preview ?? null;
        out.push({
            buildId: b.id,
            displayId: b.displayId,
            name: b.name,
            status: b.status,
            origin: b.origin,
            derivedFromBuildId: b.derivedFromBuildId,
            publication: pub ? await publicationView(pub, db) : null,
            canPublish: !reason,
            publishBlockedReason: reason,
            images: images.filter((i) => i.buildId === b.id && i.sha256).map((i) => ({ id: i.id, filename: i.filename })),
            previewSvg: preview?.svgPath ?? null,
            previewSize: preview ? { widthMm: preview.widthMm, heightMm: preview.heightMm } : null,
        });
    }
    return { rows: out };
}

// ---------------------------------------------------------------------------
// Licence gate + Make This / Remix
// ---------------------------------------------------------------------------

export type ForkGate = { pub: PublicationRow | null; license: RemixLicense | null; royaltyPct: number };

/**
 * Licence gate for forking `buildId`. 404 for a published build that went private (unless
 * the caller owns it); 403 for a remix of an all-rights-reserved design.
 */
export async function assertCanFork(buildId: string, kind: 'clone' | 'remix', viewer: ViewerContext | null, db: DbOrTx = getDb()): Promise<ForkGate> {
    const build = await loadBuildRow(buildId, db);
    if (!build) throw new ApiError('NOT_FOUND', 'Build not found');
    const pub = await loadPublication(buildId, db);
    if (!pub) return { pub: null, license: null, royaltyPct: 0 };
    const owner = ownsBuild(viewer, { ownerUserId: pub.ownerUserId });
    if (pub.visibility !== 'public' && !owner) throw new ApiError('NOT_FOUND', 'Build not found');
    if (kind === 'remix' && pub.license === 'none' && !owner) {
        throw new ApiError('FORBIDDEN', 'The creator does not allow remixes of this design. You can still order it as it is with Make This.', 403, { reason: 'LICENSE', license: pub.license });
    }
    return { pub, license: pub.license, royaltyPct: pub.royaltyPct };
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Copy `source`'s verified flat pattern into `buildId` and analyze it (so it can be quoted). */
async function copyPartInto(buildId: string, source: typeof parts.$inferSelect): Promise<string> {
    const buf = await getStorage().getObject(source.fileKey);
    const bytes = buf ? new Uint8Array(buf) : null;
    if (!bytes || (source.fileSha256 && sha256(bytes) !== source.fileSha256)) {
        throw new ApiError('CONFLICT', 'The original flat pattern of this design is not available any more.');
    }
    const partId = newId('part');
    await getDb()
        .insert(parts)
        .values({ id: partId, buildId, fileKey: storageKeys.partSource(partId), filename: source.filename, format: source.format, sizeBytes: bytes.byteLength, status: 'AWAITING_UPLOAD' });
    await uploadPartBytes(partId, bytes);
    const part = await analyzePart(partId, source.units ? { units: source.units } : {});
    if (part.status !== 'READY') throw new ApiError('CONFLICT', part.error ?? 'The copied flat pattern could not be prepared for a quote.');
    return partId;
}

/**
 * Make This (`clone`) or Remix from a build. Builds with an APPROVED design version fork their
 * Build Graph (R2 forkBuild); the latest analyzed flat pattern is copied in either case so the
 * new build is orderable right away. The new build's orders pay the parent's royalty.
 */
export async function makeFromBuild(sourceBuildId: string, kind: 'clone' | 'remix', owner: BuildOwner, viewer: ViewerContext | null, name?: string): Promise<MakeFromBuildResponse> {
    const db = getDb();
    const gate = await assertCanFork(sourceBuildId, kind, viewer, db);
    const source = (await loadBuildRow(sourceBuildId, db))!;
    const [sourcePart] = await db
        .select()
        .from(parts)
        .where(and(eq(parts.buildId, sourceBuildId), eq(parts.status, 'READY')))
        .orderBy(sql`${parts.createdAt} desc`)
        .limit(1);
    const approved = await latestApprovedVersionRow(db, sourceBuildId);
    if (!approved && !sourcePart) throw new ApiError('CONFLICT', 'This build has nothing to make yet: no approved design and no flat pattern.');
    const title = gate.pub?.title ?? source.name;
    const newName = (name ?? (kind === 'remix' ? `${title} (remix)` : title)).slice(0, 120);

    let buildId: string;
    let displayId: string;
    if (approved) {
        const forked = await forkBuild(sourceBuildId, kind, newName, { owner });
        buildId = forked.buildId;
        displayId = forked.displayId;
    } else {
        buildId = newId('build');
        const actor: Actor = owner.ownerUserId ? { kind: 'buyer', id: owner.ownerUserId } : { kind: 'buyer', id: `guest:${buildId}` };
        displayId = await withDisplayId((did) =>
            db.transaction(async (tx) => {
                await tx.insert(builds).values({ id: buildId, displayId: did, name: newName, status: 'DRAFT', origin: kind, derivedFromBuildId: sourceBuildId, currentVersion: 1, ownerUserId: owner.ownerUserId, deviceHash: owner.deviceHash });
                await emitEvent(tx, { type: 'build.created', payload: { buildId, displayId: did, name: newName }, actor, correlationId: buildId, buildId });
                await emitEvent(tx, { type: 'build.forked', payload: { buildId, derivedFromBuildId: sourceBuildId, fromVersion: Math.max(1, sourcePart?.designVersion ?? 1), kind }, actor, correlationId: buildId, buildId });
                return did;
            }),
        );
    }
    const partId = sourcePart ? await copyPartInto(buildId, sourcePart) : null;
    return {
        buildId,
        displayId,
        derivedFromBuildId: sourceBuildId,
        partId,
        nextUrl: partId ? `/parts/${partId}` : `/build/${buildId}/workspace`,
        license: gate.license ?? 'personal',
        royaltyPct: gate.royaltyPct,
    };
}

// ---------------------------------------------------------------------------
// Public build page + remix tree
// ---------------------------------------------------------------------------

/** Lineage below `rootId` (breadth-first, depth-limited), with order counts. */
export async function remixTree(rootId: string, opts: { depth?: number; db?: DbOrTx } = {}): Promise<RemixNode> {
    const db = opts.db ?? getDb();
    const maxDepth = opts.depth ?? 3;
    const root = await loadBuildRow(rootId, db);
    if (!root) throw new ApiError('NOT_FOUND', 'Build not found');
    const all: BuildRow[] = [root];
    let frontier = [rootId];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
        const kids = await db.select().from(builds).where(inArray(builds.derivedFromBuildId, frontier)).orderBy(asc(builds.createdAt)).limit(200);
        all.push(...kids);
        frontier = kids.map((k) => k.id);
    }
    const ids = all.map((b) => b.id);
    const [pubs, orderCounts] = await Promise.all([
        db.select().from(buildPublications).where(inArray(buildPublications.buildId, ids)),
        db
            .select({ buildId: orders.buildId, n: sql<number>`count(*)::int` })
            .from(orders)
            .where(and(inArray(orders.buildId, ids), inArray(orders.status, ['PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED', 'QA_FAILED', 'SHIPPED', 'DELIVERED', 'COMPLETE'])))
            .groupBy(orders.buildId),
    ]);
    const pubBy = new Map(pubs.map((p) => [p.buildId, p]));
    const creators = await loadCreatorRefs(pubs.map((p) => p.ownerUserId), db);
    const ordersBy = new Map(orderCounts.map((o) => [o.buildId, Number(o.n)]));
    const node = (b: BuildRow): RemixNode => {
        const pub = pubBy.get(b.id);
        const isPublic = pub?.visibility === 'public';
        return {
            buildId: b.id,
            displayId: b.displayId,
            title: isPublic ? pub!.title : b.id === rootId ? (pub?.title ?? b.name) : `Private ${b.origin === 'clone' ? 'copy' : 'remix'}`,
            origin: b.origin,
            public: isPublic,
            creatorName: isPublic ? creatorName(creators.get(pub!.ownerUserId)) : null,
            orders: ordersBy.get(b.id) ?? 0,
            children: all.filter((k) => k.derivedFromBuildId === b.id && k.id !== b.id).map(node),
        };
    };
    return node(root);
}

export async function publicBuildView(buildId: string, viewer: ViewerContext | null): Promise<PublicBuildView | null> {
    const db = getDb();
    const pub = await loadPublication(buildId, db);
    if (!pub) return null;
    const owner = ownsBuild(viewer, { ownerUserId: pub.ownerUserId });
    if (pub.visibility !== 'public' && !owner) return null;
    const build = await loadBuildRow(buildId, db);
    if (!build) return null;
    const [card] = await buildCards([pub], db);
    const commerce = (await loadBuildCommerce([buildId], db)).get(buildId);
    const approved = await latestApprovedVersionRow(db, buildId);
    const hasSomething = !!approved || !!commerce?.part;
    let parent: PublicBuildView['parent'] = null;
    if (build.derivedFromBuildId) {
        const p = await loadBuildRow(build.derivedFromBuildId, db);
        const ppub = p ? await loadPublication(p.id, db) : null;
        if (p) {
            const isPublic = ppub?.visibility === 'public';
            const creators = ppub ? await loadCreatorRefs([ppub.ownerUserId], db) : new Map();
            parent = { buildId: p.id, displayId: p.displayId, title: isPublic ? ppub!.title : 'A private build', public: isPublic, creatorName: isPublic ? creatorName(creators.get(ppub!.ownerUserId)) : null };
        }
    }
    const q = commerce?.quote ?? null;
    const { clipsForBuild } = await import('./clips');
    return {
        card,
        description: pub.description,
        licenseText: LICENSE_TEXT[pub.license],
        visibility: pub.visibility,
        viewerIsOwner: owner,
        canMakeThis: hasSomething,
        canRemix: hasSomething && (pub.license !== 'none' || owner),
        quote: q
            ? {
                  quoteId: q.id,
                  unitPriceCents: q.unitPriceCents,
                  quantity: q.quantity,
                  leadTimeDays: q.leadTimeDays,
                  materialLabel: `${q.summary.materialName} ${q.summary.thicknessLabel}`,
                  orderable: true,
              }
            : null,
        parent,
        remixTree: await remixTree(buildId, { db }),
        clips: await clipsForBuild(buildId, 6),
    };
}
