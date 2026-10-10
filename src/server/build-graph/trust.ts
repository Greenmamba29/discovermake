/**
 * Build trust state (workflow 03): derived on every read, never stored.
 *
 *   ORDERABLE            an orderable BINDING quote exists (same rule as checkout: `isQuoteOrderable`)
 *   SUPPLIER_CONFIRMED   a supplier offer for the current design version is SUPPLIER_CONFIRMED and ACTIVE/SELECTED
 *   MANUFACTURING_READY  a part of the build was analyzed READY
 *   ENGINEERING_REVIEW   an APPROVED design version with no open unknowns
 *   CONCEPT              otherwise
 *
 * The highest state that holds wins. A concept never borrows a higher state: each rung
 * needs its own evidence row.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BuildTrustState } from '../../contracts/enums';
import { getDb, type DbOrTx } from '../db';
import { bgNodes, parts, quotes, supplierOffers } from '../db/schema';
import { isQuoteOrderable } from '../quote';
import { latestApprovedVersionRow } from './versions';

export async function deriveBuildTrustState(build: { id: string; currentVersion: number }, db: DbOrTx = getDb()): Promise<BuildTrustState> {
    const now = new Date();
    const binding = await db
        .select({
            status: quotes.status,
            trustLevel: quotes.trustLevel,
            validUntil: quotes.validUntil,
            designVersion: quotes.designVersion,
            rulesetVersion: quotes.rulesetVersion,
            partDesignVersion: parts.designVersion,
            partRulesetVersion: parts.rulesetVersion,
        })
        .from(quotes)
        .innerJoin(parts, eq(parts.id, quotes.partId))
        .where(and(eq(quotes.buildId, build.id), eq(quotes.status, 'READY'), eq(quotes.trustLevel, 'BINDING')));
    if (binding.some((q) => isQuoteOrderable(q, { designVersion: q.partDesignVersion, rulesetVersion: q.partRulesetVersion }, now))) return 'ORDERABLE';

    const [confirmed] = await db
        .select({ id: supplierOffers.id })
        .from(supplierOffers)
        .where(
            and(
                eq(supplierOffers.buildId, build.id),
                eq(supplierOffers.designVersion, build.currentVersion),
                eq(supplierOffers.trustLevel, 'SUPPLIER_CONFIRMED'),
                inArray(supplierOffers.status, ['ACTIVE', 'SELECTED']),
            ),
        )
        .limit(1);
    if (confirmed) return 'SUPPLIER_CONFIRMED';

    const [ready] = await db
        .select({ id: parts.id })
        .from(parts)
        .where(and(eq(parts.buildId, build.id), eq(parts.status, 'READY')))
        .limit(1);
    if (ready) return 'MANUFACTURING_READY';

    const approved = await latestApprovedVersionRow(db, build.id);
    if (approved) {
        const [open] = await db
            .select({ id: bgNodes.id })
            .from(bgNodes)
            .where(and(eq(bgNodes.buildId, build.id), eq(bgNodes.designVersion, approved.version), eq(bgNodes.type, 'UNKNOWN'), sql`${bgNodes.data}->>'status' = 'open'`))
            .limit(1);
        if (!open) return 'ENGINEERING_REVIEW';
    }
    return 'CONCEPT';
}
