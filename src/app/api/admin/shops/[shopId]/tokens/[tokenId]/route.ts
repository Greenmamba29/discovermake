/** DELETE /api/admin/shops/:shopId/tokens/:tokenId -> OkResponse (revokes the token and its sessions). Auth: Bearer ADMIN_TOKEN. */
import type { OkResponse } from '@/contracts/common';
import { requireAdmin } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { revokeShopToken } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route<{ shopId: string; tokenId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const { shopId, tokenId } = await params;
    await revokeShopToken(shopId, tokenId);
    return json<OkResponse>({ ok: true });
});
