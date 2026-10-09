/**
 * PUT /api/admin/sourcing/clients/:clientId/allowlist  SourcingClientAllowlist -> SourcingClientView
 *
 * Replaces an MCP client's per-workspace allowlist: `allowedTools` (tool short names, null = all
 * nine) and `allowedCidrs` (IP addresses / CIDR ranges, null = any IP). Takes effect on the
 * client's next request. 409 for a revoked client. Auth: Bearer ADMIN_TOKEN.
 */
import { idOf } from '@/contracts/common';
import { SourcingClientAllowlist } from '@/contracts/sourcing';
import { requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { pathId } from '@/server/quote/route-helpers';
import { updateSourcingClientAllowlist } from '@/server/sourcing/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = route<{ clientId: string }>(async (request, { params }) => {
    requireAdmin(request);
    const clientId = pathId((await params).clientId, idOf('sourcingClient'), 'Sourcing client');
    const body = await parseJson(request, SourcingClientAllowlist);
    return json(await updateSourcingClientAllowlist(clientId, body));
});
