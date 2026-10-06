/** POST /api/admin/shops/:shopId/tokens  { label, expiresAt? } -> ShopConsoleTokenView (201, token shown once). Auth: Bearer ADMIN_TOKEN. */
import { ShopId } from '@/contracts/common';
import { requireAdmin } from '@/server/auth/admin';
import { ApiError, json, parseJson, route } from '@/server/http';
import { issueShopToken, IssueShopTokenRequest } from '@/server/shops/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<{ shopId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const id = ShopId.safeParse((await params).shopId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Shop not found');
    const body = await parseJson(request, IssueShopTokenRequest);
    return json(await issueShopToken(id.data, body), { status: 201 });
});
