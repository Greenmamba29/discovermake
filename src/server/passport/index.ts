/**
 * Product Passport: signed record of what was actually manufactured (workflow 09).
 *
 * OWNER: shop agent. Signatures FINAL.
 *
 * snapshot_hash = sha256(canonicalJson(snapshot))   (canonicalJson from src/server/auth/tokens.ts)
 * signature     = HMAC-SHA256(PASSPORT_SIGNING_SECRET, snapshot_hash)
 * Every snapshot field is read from real rows (order, quote, part, shop, milestones,
 * inspection result, shipment); activation fails rather than inventing data.
 * The snapshot carries no buyer PII (no name, email or address; the tracking
 * number is masked to its last 4 characters).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { SYSTEM_ACTOR } from '../../contracts/common';
import { PassportSnapshot, type PassportPublicView, type PassportVerifyResponse } from '../../contracts/passport';
import { canonicalJson, hmacHex, safeEqual, sha256Hex } from '../auth/tokens';
import { getDb, withTx, type DbOrTx } from '../db';
import { builds, inspectionPlans, inspectionResults, manufacturingJobs, orders, parts, passports, productionMilestones, quotes, shipments, shops, thicknessOptions } from '../db/schema';
import { env, requireSecret } from '../env';
import { emitEvent } from '../events/outbox';
import { newId } from '../ids';

export const PASSPORT_KEY_ID = 'passport-v1';

export class PassportActivationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PassportActivationError';
    }
}

export function hashSnapshot(snapshot: PassportSnapshot): string {
    return sha256Hex(canonicalJson(snapshot));
}

export function signSnapshotHash(snapshotHash: string): string {
    return hmacHex(requireSecret('PASSPORT_SIGNING_SECRET'), snapshotHash);
}

export function passportUrl(passportId: string): string {
    return new URL(`/passport/${encodeURIComponent(passportId)}`, env().APP_URL).toString();
}

/** QR code (PNG data URL) encoding the public verify URL, for packaging labels and the verify page. */
export async function passportQrCodeDataUrl(passportId: string): Promise<string> {
    return QRCode.toDataURL(passportUrl(passportId), { errorCorrectionLevel: 'M', margin: 1, width: 320 });
}

function maskTracking(trackingNumber: string): string {
    return trackingNumber.length <= 4 ? trackingNumber : `••••${trackingNumber.slice(-4)}`;
}

/** Build the snapshot from real rows. Throws PassportActivationError when a required record is missing. */
async function buildSnapshot(t: DbOrTx, order: typeof orders.$inferSelect, passportId: string): Promise<PassportSnapshot> {
    const missing = (what: string) => new PassportActivationError(`Cannot activate passport for ${order.orderNumber}: ${what}`);
    const [[build], [quote]] = await Promise.all([
        t.select().from(builds).where(eq(builds.id, order.buildId)),
        t.select().from(quotes).where(eq(quotes.id, order.quoteId)),
    ]);
    if (!build || !quote) throw missing('build or quote not found');
    const [[part], [thickness]] = await Promise.all([
        t.select().from(parts).where(eq(parts.id, quote.partId)),
        t.select().from(thicknessOptions).where(eq(thicknessOptions.id, quote.config.thicknessOptionId)),
    ]);
    if (!part) throw missing('part not found');
    if (!thickness) throw missing('thickness option not found');
    if (!order.shopId) throw missing('no shop assigned');
    const [shop] = await t.select().from(shops).where(eq(shops.id, order.shopId));
    if (!shop) throw missing('shop not found');

    const [passing] = await t
        .select({ result: inspectionResults, plan: inspectionPlans })
        .from(inspectionResults)
        .innerJoin(inspectionPlans, eq(inspectionPlans.id, inspectionResults.planId))
        .where(and(eq(inspectionResults.orderId, order.id), eq(inspectionResults.outcome, 'PASS')))
        .orderBy(desc(inspectionResults.createdAt))
        .limit(1);
    if (!passing) throw missing('no passing inspection result');
    // The file hash comes from the snapshot taken at dispatch (what the shop actually made),
    // falling back to the part row only for jobs dispatched before that snapshot existed.
    const [passingJob] = await t
        .select({ sourceFileSha256: manufacturingJobs.sourceFileSha256 })
        .from(manufacturingJobs)
        .where(eq(manufacturingJobs.id, passing.result.jobId));
    const fileSha256 = passingJob?.sourceFileSha256 ?? part.fileSha256;
    if (!fileSha256) throw missing('part file hash was never verified');

    const [shipment] = await t
        .select()
        .from(shipments)
        .where(and(eq(shipments.orderId, order.id), eq(shipments.status, 'DELIVERED')))
        .orderBy(desc(shipments.deliveredAt))
        .limit(1);
    if (!shipment || !shipment.deliveredAt) throw missing('no delivered shipment');

    const milestones = await t.select().from(productionMilestones).where(eq(productionMilestones.orderId, order.id)).orderBy(asc(productionMilestones.occurredAt));
    const passingJobMilestones = milestones.filter((m) => m.jobId === passing.result.jobId);
    const firstMilestone = passingJobMilestones[0] ?? milestones[0];
    if (!firstMilestone) throw missing('no production milestones recorded');

    const measurements = new Map(passing.result.measurements.map((m) => [m.checkId, m]));
    const snapshot: PassportSnapshot = {
        snapshotVersion: 1,
        passportId,
        orderNumber: order.orderNumber,
        build: { id: build.id, displayId: build.displayId, name: build.name },
        designVersion: quote.designVersion,
        quoteId: quote.id,
        part: {
            filename: part.filename,
            fileSha256,
            bboxWidthMm: part.features?.bboxWidthMm ?? quote.summary.bboxWidthMm,
            bboxHeightMm: part.features?.bboxHeightMm ?? quote.summary.bboxHeightMm,
        },
        material: { name: quote.summary.materialName, thicknessLabel: quote.summary.thicknessLabel, thicknessMm: thickness.thicknessMm },
        process: quote.summary.processName,
        finish: quote.summary.finishName,
        services: quote.summary.serviceNames,
        quantity: order.quantity,
        shop: { id: shop.id, name: shop.name, city: shop.city, region: shop.region },
        manufacturedAt: firstMilestone.occurredAt.toISOString(),
        milestones: milestones.map((m) => ({ kind: m.kind, at: m.occurredAt.toISOString() })),
        qa: {
            resultId: passing.result.id,
            outcome: passing.result.outcome,
            inspectedAt: passing.result.createdAt.toISOString(),
            inspectorName: passing.result.inspectorName,
            checks: passing.plan.checks.map((c) => {
                const m = measurements.get(c.id);
                return { label: c.label, nominalMm: c.nominalMm, measuredValue: m?.measuredValue ?? null, pass: m?.pass ?? false };
            }),
        },
        shipment: { carrier: shipment.carrier, trackingNumber: maskTracking(shipment.trackingNumber), deliveredAt: shipment.deliveredAt.toISOString() },
        lot: `${order.orderNumber}-L1`,
        rulesetVersion: quote.rulesetVersion,
    };
    return PassportSnapshot.parse(snapshot);
}

/**
 * Build, sign and activate the passport for a DELIVERED order. Emits
 * `passport.activated`. Idempotent (one passport per order).
 * @throws Error when required records (passing inspection, delivered shipment) are missing.
 */
export async function activatePassport(orderId: string, tx?: DbOrTx): Promise<{ passportId: string }> {
    return withTx(async (t) => {
        const [order] = await t.select().from(orders).where(eq(orders.id, orderId)).for('update');
        if (!order) throw new PassportActivationError(`Order ${orderId} not found`);
        const [existing] = await t.select().from(passports).where(eq(passports.orderId, orderId));
        if (existing) return { passportId: existing.id };
        if (order.status !== 'DELIVERED' && order.status !== 'COMPLETE') {
            throw new PassportActivationError(`Passports activate on delivery; order ${order.orderNumber} is ${order.status}`);
        }

        const passportId = newId('passport');
        const snapshot = await buildSnapshot(t, order, passportId);
        const snapshotHash = hashSnapshot(snapshot);
        const now = new Date();
        await t.insert(passports).values({
            id: passportId,
            orderId,
            buildId: order.buildId,
            status: 'ACTIVE',
            snapshot,
            snapshotHash,
            signature: signSnapshotHash(snapshotHash),
            signatureAlg: 'HMAC-SHA256',
            keyId: PASSPORT_KEY_ID,
            activatedAt: now,
        });
        await emitEvent(t, {
            type: 'passport.activated',
            payload: { passportId, orderId, snapshotHash },
            actor: SYSTEM_ACTOR,
            correlationId: order.correlationId,
            buildId: order.buildId,
            orderId,
            timestamp: now,
        });
        return { passportId };
    }, tx);
}

type PassportRow = typeof passports.$inferSelect;

function verifyRow(row: PassportRow): { computedHash: string; hashValid: boolean; signatureValid: boolean } {
    const computedHash = hashSnapshot(row.snapshot);
    const hashValid = computedHash === row.snapshotHash;
    const signatureValid = hashValid && row.signatureAlg === 'HMAC-SHA256' && safeEqual(signSnapshotHash(row.snapshotHash), row.signature);
    return { computedHash, hashValid, signatureValid };
}

async function loadPassport(id: string): Promise<PassportRow | null> {
    if (!/^pps_[A-Za-z0-9_-]+$/.test(id) || id.length > 64) return null;
    const [row] = await getDb().select().from(passports).where(eq(passports.id, id));
    return row ?? null;
}

/** Public passport (no buyer PII), re-verified at read time. Null when not found or not ACTIVE. */
export async function getPublicPassport(id: string): Promise<PassportPublicView | null> {
    const row = await loadPassport(id);
    if (!row || row.status !== 'ACTIVE') return null;
    const v = verifyRow(row);
    return {
        id: row.id,
        status: row.status,
        activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
        verified: v.hashValid && v.signatureValid,
        snapshotHash: row.snapshotHash,
        signatureAlg: 'HMAC-SHA256',
        verifyUrl: passportUrl(row.id),
        snapshot: row.snapshot,
        manufacturedOn: row.snapshot.manufacturedAt.slice(0, 10),
    };
}

/** Recompute hash + signature from the stored snapshot. Null when not found. */
export async function verifyPassport(id: string): Promise<PassportVerifyResponse | null> {
    const row = await loadPassport(id);
    if (!row) return null;
    const v = verifyRow(row);
    return {
        id: row.id,
        valid: v.hashValid && v.signatureValid && row.status === 'ACTIVE',
        status: row.status,
        snapshotHash: row.snapshotHash,
        computedHash: v.computedHash,
        signatureValid: v.signatureValid,
        activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    };
}
