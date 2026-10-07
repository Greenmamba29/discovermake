/**
 * Quote engine: part upload, DXF geometry analysis, DFM, catalog and instant
 * BINDING quotes (workflow 02).
 *
 * OWNER: quote agent. Owns src/server/quote/**, src/app/api/{catalog,parts,builds,quotes}/**, tests/quote/**.
 * Signatures in this file are FINAL: other modules and routes compile against them.
 *
 * Rules:
 * - Prices are computed here and only here, from the shop rate card + catalog rows.
 * - Quotes are immutable snapshots (insert only; status may move READY -> EXPIRED/ORDERED).
 * - Every state change emits a domain event in the same transaction:
 *   build.created, part.uploaded, part.analyzed, dfm.completed, quote.created.
 * - `quotes.shop_cost_cents + quotes.platform_fee_cents = quotes.subtotal_cents` (DB check).
 *
 * Module layout:
 *   dxf/sniff.ts         extension + magic-byte checks (ASCII DXF R12–R2018; STEP = R1.5)
 *   dxf/parse.ts         dxf-parser -> exact line/arc edges (splines/ellipses tessellated)
 *   geometry/*           cleaning, contour joining (0.01 mm), features, preview
 *   analyze.ts           units resolution + feature assembly (pure)
 *   dfm.ts               versioned rules (pure)
 *   pricing.ts           pricing model (pure)
 *   leadtime.ts          business-day ship dates (pure)
 *   shipping.ts          binding shipping options (pure)
 *   catalog.ts parts.ts quotes.ts   persistence
 */
import type { CatalogResponse } from '../../contracts/catalog';
import type { AnalyzePartRequest, BuildView, CreatePartRequest, CreatePartResponse, PartView } from '../../contracts/parts';
import type { CreateQuoteRequest, QuoteView } from '../../contracts/quotes';
import { getDb, type DbOrTx } from '../db';
import { buildCatalog } from './catalog';
import { analyzePartImpl, createPartUploadImpl, getBuildView, getPartView, uploadPartBytesImpl } from './parts';
import { createQuoteImpl, getQuoteImpl, markQuoteOrderedImpl } from './quotes';

export { QUOTE_MAX_UPLOAD_BYTES, DXF_CONTENT_TYPE } from './parts';
export { QUOTE_VALIDITY_DAYS, isQuoteOrderable } from './quotes';
export { PRICING_VERSION, QUOTE_LADDER_QUANTITIES } from './pricing';
export { assertDxfFilename, UnsupportedFileError } from './dxf/sniff';

/**
 * Create a Build + Part row for an upload and return a signed PUT URL for the
 * bytes (storage key `parts/<partId>/source.dxf`, 25 MB cap, Content-Type
 * `application/dxf` — send exactly `upload.headers`).
 * Emits `build.created`. Part status starts at AWAITING_UPLOAD.
 * @throws ApiError UNSUPPORTED_MEDIA_TYPE (non-DXF; STEP gets a "coming in R1.5" message), PAYLOAD_TOO_LARGE.
 */
export async function createPartUpload(input: CreatePartRequest): Promise<CreatePartResponse> {
    return createPartUploadImpl(input);
}

/**
 * Direct server-side upload of the part bytes (multipart/form-data or raw body via
 * `POST /api/parts/:partId/upload`). Same caps as the signed PUT plus an immediate
 * content sniff. The client then calls `analyzePart`.
 */
export async function uploadPartBytes(partId: string, bytes: Uint8Array): Promise<PartView> {
    return uploadPartBytesImpl(partId, bytes);
}

/**
 * Verify the uploaded object (exists, size cap, DXF magic/structure), parse it,
 * normalize to mm, extract features, run geometry-only DFM and build the preview.
 * - Units: explicit `input.units`; else DXF $INSUNITS; else inferred when only one of
 *   mm/inch gives a plausible part size; otherwise status NEEDS_INPUT (preview is then
 *   in raw drawing units so the UI can show the shape while asking).
 * - Re-analyzing with different units or new bytes bumps `design_version` (staling older quotes).
 * - Unsupported / unreadable files return status FAILED with a buyer-facing `error`.
 * Emits `part.uploaded` (new verified bytes), `part.analyzed`, `dfm.completed`.
 * @throws ApiError NOT_FOUND when the part does not exist, CONFLICT when no bytes were uploaded.
 */
export async function analyzePart(partId: string, input?: AnalyzePartRequest): Promise<PartView> {
    return analyzePartImpl(partId, input ?? {});
}

/** Part view, or null when not found. */
export async function getPart(partId: string): Promise<PartView | null> {
    return getPartView(partId);
}

/** Build view (with its part and latest quote id), or null when not found. */
export async function getBuild(buildId: string): Promise<BuildView | null> {
    return getBuildView(buildId);
}

/** Active catalog for the configurator (materials x thickness x services). Buyer-safe (no shop costs). */
export async function getCatalog(): Promise<CatalogResponse> {
    return buildCatalog(getDb());
}

/**
 * Price a configuration against the best capable ACTIVE shop's active rate card
 * and persist an immutable quote with line items, ladder (1/10/25/50/100/250),
 * shipping options, material-specific DFM, ship date and valid_until (14 days).
 * - Blocking DFM -> status NEEDS_INPUT, trustLevel SUPPLIER_ESTIMATE, orderable=false (still persisted + returned).
 * - Outside catalog / no capable shop -> status REVIEW, trustLevel SUPPLIER_ESTIMATE.
 * - Otherwise status READY, trustLevel BINDING.
 * Emits `dfm.completed` and `quote.created`.
 * @throws ApiError NOT_FOUND (part), CONFLICT (part not READY), VALIDATION_FAILED (incompatible options).
 */
export async function createQuote(input: CreateQuoteRequest): Promise<QuoteView> {
    return createQuoteImpl(input);
}

/**
 * Quote view, or null when not found. `orderable` is computed at read time:
 * READY + BINDING + before valid_until + same design version and rule-set version
 * as the part. A READY quote that fails those checks is reported as EXPIRED.
 */
export async function getQuote(id: string): Promise<QuoteView | null> {
    return getQuoteImpl(id);
}

/**
 * Mark a READY quote ORDERED inside the checkout/payment transaction.
 * Called by the orders module when payment succeeds. Idempotent.
 * @throws ApiError NOT_FOUND, CONFLICT (quote is NEEDS_INPUT / REVIEW / EXPIRED).
 */
export async function markQuoteOrdered(quoteId: string, tx?: DbOrTx): Promise<void> {
    return markQuoteOrderedImpl(quoteId, tx);
}
