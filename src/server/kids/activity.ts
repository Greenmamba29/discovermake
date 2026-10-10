/** Family activity log (approvals, declines, Kids mode, profile changes). */
import type { FamilyActivityKind } from '@/contracts/kids';
import type { DbOrTx } from '../db';
import { familyActivity } from '../db/schema';
import { newId } from '../ids';

export async function logActivity(db: DbOrTx, ownerUserId: string, kidId: string | null, kind: FamilyActivityKind, summary: string): Promise<void> {
    await db.insert(familyActivity).values({ id: newId('familyActivity'), ownerUserId, kidId, kind, summary: summary.slice(0, 200) });
}
