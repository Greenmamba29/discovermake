/**
 * submit_supplier / submit_offer / update_negotiation / attach_document / get_attachments.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { domainEvents, sourcingAccessLog, sourcingDocuments, supplierEvidence, supplierOffers, suppliers } from '@/server/db/schema';
import { getStorage } from '@/server/storage';
import { getAttachments } from '@/server/sourcing/attachments';
import { attachDocument, matchesContentType } from '@/server/sourcing/documents';
import { SourcingError } from '@/server/sourcing/errors';
import { updateNegotiation } from '@/server/sourcing/negotiations';
import { boundExceptions, listJobOffers, offerTrustLevel, submitOffer } from '@/server/sourcing/offers';
import { submitSupplier } from '@/server/sourcing/suppliers';
import { useTestDb } from '../support/db';
import { bumpDesignVersion, createJobFixture, leaseJob, newClient, offerInput, quietConsole, supplierFor } from './fixtures';

async function expectCode(p: Promise<unknown>, code: string) {
    const err = await p.then(
        () => null,
        (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SourcingError);
    expect((err as SourcingError).sourcingCode).toBe(code);
    return err as SourcingError;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.7\n%test quote\n');

describe('sourcing offers, suppliers, documents, attachments', () => {
    const ctx = useTestDb({ seed: true });
    beforeAll(() => quietConsole());

    async function leased(opts: Parameters<typeof createJobFixture>[1] = {}) {
        const f = await createJobFixture(ctx.db, opts);
        const client = await newClient();
        const lease = await leaseJob(ctx.db, f.job.id, client.clientId);
        return { ...f, client, ...lease };
    }

    it('de-duplicates suppliers on (platform, platform_ref) and stores evidence per job', async () => {
        const { job, writer } = await leased();
        const a = await supplierFor(job.id, writer, { platform_ref: 'alibaba-shenzhen-01', verified: false });
        const again = await submitSupplier(
            {
                sourcing_request_id: job.id,
                name: 'Shenzhen Precision (renamed)',
                platform: 'alibaba',
                platform_ref: 'alibaba-shenzhen-01',
                country: 'CN',
                verified: true,
                capabilities: ['anodizing'],
                evidence: [{ kind: 'certificate', note: 'ISO 9001 certificate', url: 'https://example.com/iso.pdf' }],
            },
            writer,
        );
        expect(again.created).toBe(false);
        expect(again.supplier.id).toBe(a.id);
        expect(again.supplier.verified).toBe(true);
        expect(again.supplier.capabilities.sort()).toEqual(['anodizing', 'laser cutting']);
        expect(await ctx.db.select().from(supplierEvidence).where(eq(supplierEvidence.supplierId, a.id))).toHaveLength(2);
        const found = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.supplier_found'), eq(domainEvents.buildId, job.buildId)));
        expect(found).toHaveLength(2);
        expect(await ctx.db.select().from(suppliers).where(eq(suppliers.platformRef, 'alibaba-shenzhen-01'))).toHaveLength(1);
    });

    it('submit_offer is idempotent on (job, idempotency_key) and emits sourcing.offer_received once', async () => {
        const { job, writer } = await leased();
        const s = await supplierFor(job.id, writer);
        const first = await submitOffer(offerInput(job.id, s.id), writer);
        expect(first.duplicate).toBe(false);
        const retry = await submitOffer(offerInput(job.id, s.id, { unit_price_cents: 1 }), writer);
        expect(retry.duplicate).toBe(true);
        expect(retry.offer.id).toBe(first.offer.id);
        expect(retry.offer.unitPriceCents).toBe(700);
        expect(await ctx.db.select().from(supplierOffers).where(eq(supplierOffers.jobId, job.id))).toHaveLength(1);
        const received = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.offer_received'), eq(domainEvents.buildId, job.buildId)));
        expect(received).toHaveLength(1);
        expect(received[0].payload).toMatchObject({ offerId: first.offer.id, trustLevel: 'SUPPLIER_CONFIRMED', unitPriceCents: 700, quantity: 10 });
    });

    it('rejects offers for another design version, and offers once the build moved on', async () => {
        const { job, writer, part } = await leased();
        const s = await supplierFor(job.id, writer);
        await expectCode(submitOffer(offerInput(job.id, s.id, { design_version: 2 }), writer), 'STALE_DESIGN_VERSION');
        const ok = await submitOffer(offerInput(job.id, s.id), writer);
        await bumpDesignVersion(ctx.db, part.id);
        await expectCode(submitOffer(offerInput(job.id, s.id, { idempotency_key: 'after-bump-0001' }), writer), 'STALE_DESIGN_VERSION');
        // Listing marks the old offer STALE.
        const [view] = await listJobOffers(job.id);
        expect(view.id).toBe(ok.offer.id);
        expect(view.status).toBe('STALE');
        const stale = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.offer_stale'), eq(domainEvents.correlationId, job.id)));
        expect(stale.map((e) => e.payload)).toEqual([{ offerId: ok.offer.id, jobId: job.id, offerVersion: 1, currentVersion: 2 }]);
    });

    it('maps trust: SUPPLIER_CONFIRMED only for supplier-confirmed offers without exceptions', async () => {
        expect(offerTrustLevel('supplier-confirmed', [])).toBe('SUPPLIER_CONFIRMED');
        expect(offerTrustLevel('supplier-confirmed', ['Finish: clear anodize instead of black'])).toBe('SUPPLIER_ESTIMATE');
        for (const s of ['contacted', 'rfq-sent', 'awaiting-reply', 'negotiating', 'supplier-estimate', 'declined', 'no-response'] as const) {
            expect(offerTrustLevel(s, [])).toBe('SUPPLIER_ESTIMATE');
        }
        const { job, writer } = await leased();
        const s = await supplierFor(job.id, writer);
        const est = await submitOffer(offerInput(job.id, s.id, { idempotency_key: 'estimate-0001', negotiation_status: 'supplier-estimate' }), writer);
        expect(est.offer.trustLevel).toBe('SUPPLIER_ESTIMATE');
        const exc = await submitOffer(offerInput(job.id, s.id, { idempotency_key: 'exception-0001', exceptions: ['Tolerance ±0.2 mm instead of ±0.1 mm'] }), writer);
        expect(exc.offer.trustLevel).toBe('SUPPLIER_ESTIMATE');
        const conf = await submitOffer(offerInput(job.id, s.id, { idempotency_key: 'confirmed-0001' }), writer);
        expect(conf.offer.trustLevel).toBe('SUPPLIER_CONFIRMED');
        const trusts = (await ctx.db.select().from(supplierOffers)).map((o) => o.trustLevel);
        expect(trusts.every((t) => t === 'SUPPLIER_CONFIRMED' || t === 'SUPPLIER_ESTIMATE')).toBe(true);
    });

    it('stores offers outside the negotiation bounds, flagged in exceptions (and never confirmed)', async () => {
        expect(boundExceptions({ unit_price_cents: 900, production_lead_days: 10, shipping_lead_days: 5, quantity: 10, moq: 10 }, { quantity: 10 }, { max_unit_price_cents: 900, max_total_lead_days: 15 })).toEqual([]);
        const { job, writer } = await leased({ targetUnitCostCents: 800, targetDeliveryDate: new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10) });
        const s = await supplierFor(job.id, writer);
        const over = await submitOffer(offerInput(job.id, s.id, { unit_price_cents: 950, production_lead_days: 30, shipping_lead_days: 10, moq: 50 }), writer);
        expect(over.offer.status).toBe('ACTIVE');
        expect(over.offer.trustLevel).toBe('SUPPLIER_ESTIMATE');
        expect(over.offer.exceptions.join('\n')).toMatch(/above the target unit cost of \$8\.00/);
        expect(over.offer.exceptions.join('\n')).toMatch(/misses the target delivery date/);
        expect(over.offer.exceptions.join('\n')).toMatch(/Minimum order quantity 50/);
        const within = await submitOffer(offerInput(job.id, s.id, { idempotency_key: 'within-bounds-01', unit_price_cents: 790 }), writer);
        expect(within.offer.exceptions).toEqual([]);
        expect(within.offer.trustLevel).toBe('SUPPLIER_CONFIRMED');
    });

    it('validates supplier, attachments and validity', async () => {
        const { job, writer } = await leased();
        await expectCode(submitOffer(offerInput(job.id, 'sup_doesnotexist'), writer), 'NOT_FOUND');
        const s = await supplierFor(job.id, writer);
        await expectCode(submitOffer(offerInput(job.id, s.id, { attachment_ids: ['sdoc_nope'] }), writer), 'VALIDATION_FAILED');
        await expectCode(submitOffer(offerInput(job.id, s.id, { valid_until: '2001-01-01T00:00:00Z' }), writer), 'VALIDATION_FAILED');
    });

    it('update_negotiation upserts one thread per supplier and appends notes', async () => {
        const { job, writer } = await leased();
        const s = await supplierFor(job.id, writer);
        await updateNegotiation({ sourcing_request_id: job.id, supplier_id: s.id, status: 'rfq-sent', note: 'Sent RFQ with redacted package' }, writer);
        const row = await updateNegotiation({ sourcing_request_id: job.id, supplier_id: s.id, status: 'negotiating', note: 'Asked for 5% off at 25 pcs' }, writer);
        expect(row.status).toBe('negotiating');
        expect(row.notes.map((n) => n.status)).toEqual(['rfq-sent', 'negotiating']);
        const evs = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.negotiation_updated'), eq(domainEvents.buildId, job.buildId)));
        expect(evs).toHaveLength(2);
    });

    it('attach_document checks magic bytes and size, stores under sourcing/<jobId>/ with sha256', async () => {
        expect(matchesContentType(PNG, 'image/png')).toBe(true);
        expect(matchesContentType(PNG, 'application/pdf')).toBe(false);
        expect(matchesContentType(PDF, 'text/plain')).toBe(false);
        expect(matchesContentType(Buffer.from('a,b\n1,2\n'), 'text/csv')).toBe(true);
        const { job, writer } = await leased();
        const s = await supplierFor(job.id, writer);
        await expectCode(
            attachDocument({ sourcing_request_id: job.id, kind: 'QUOTE', filename: 'quote.pdf', content_type: 'application/pdf', content_base64: PNG.toString('base64') }, writer),
            'VALIDATION_FAILED',
        );
        await expectCode(attachDocument({ sourcing_request_id: job.id, kind: 'QUOTE', filename: 'q.pdf', content_type: 'application/pdf', content_base64: 'not base64!!' }, writer), 'VALIDATION_FAILED');
        const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
        await expectCode(attachDocument({ sourcing_request_id: job.id, kind: 'QUOTE', filename: 'big.pdf', content_type: 'application/pdf', content_base64: big }, writer), 'VALIDATION_FAILED');

        const doc = await attachDocument(
            { sourcing_request_id: job.id, supplier_id: s.id, kind: 'QUOTE', filename: 'Formal quote (v1).pdf', content_type: 'application/pdf', content_base64: PDF.toString('base64') },
            writer,
        );
        expect(doc.fileKey.startsWith(`sourcing/${job.id}/documents/`)).toBe(true);
        expect(doc.sizeBytes).toBe(PDF.length);
        expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect((await getStorage().getObject(doc.fileKey))?.equals(PDF)).toBe(true);
        // The offer can reference it.
        const offer = await submitOffer(offerInput(job.id, s.id, { attachment_ids: [doc.id] }), writer);
        expect(offer.duplicate).toBe(false);
        expect(await ctx.db.select().from(sourcingDocuments).where(eq(sourcingDocuments.jobId, job.id))).toHaveLength(1);
    });

    it('get_attachments returns signed 15-minute URLs for the REDACTED package (never the CAD) and logs every access', async () => {
        const { job, client, leaseId, part } = await leased();
        const files = await getAttachments({ sourcing_request_id: job.id, lease_id: leaseId, tier: 'REDACTED' }, client.clientId);
        expect(files.map((f) => f.name).sort()).toEqual(['preview.svg', 'request-sheet.txt']);
        for (const f of files) {
            expect(f.tier).toBe('REDACTED');
            expect(f.url).toMatch(/^http:\/\/localhost:3100\/api\/storage\/local\/sourcing\//);
            const ttl = Date.parse(f.expires_at) - Date.now();
            expect(ttl).toBeGreaterThan(14 * 60_000);
            expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 1000);
            expect(f.url).not.toContain(part.fileKey);
        }
        const sheet = (await getStorage().getObject(`sourcing/${job.id}/package/v1/request-sheet-redacted.txt`))!.toString();
        expect(sheet).toContain(job.displayId);
        expect(sheet).not.toContain(job.buildId);
        expect(sheet).not.toContain(job.id);
        const svg = (await getStorage().getObject(`sourcing/${job.id}/package/v1/preview.svg`))!.toString();
        expect(svg).toMatch(/^<svg /);

        const log = await ctx.db.select().from(sourcingAccessLog).where(eq(sourcingAccessLog.jobId, job.id));
        expect(log).toHaveLength(2);
        expect(log.every((l) => l.clientId === client.clientId && l.tier === 'REDACTED')).toBe(true);
        expect(log.map((l) => l.fileKey)).not.toContain(part.fileKey);
        const [ev] = await ctx.db
            .select()
            .from(domainEvents)
            .where(and(eq(domainEvents.eventType, 'sourcing.package_accessed'), eq(domainEvents.buildId, job.buildId)));
        expect(ev.payload).toMatchObject({ jobId: job.id, clientId: client.clientId, tier: 'REDACTED', supplierId: null });

        await expectCode(getAttachments({ sourcing_request_id: job.id, lease_id: '00000000-0000-4000-8000-000000000000', tier: 'REDACTED' }, client.clientId), 'LEASE_INVALID');
    });
});
