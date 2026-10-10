/**
 * GET  /api/admin/sourcing/clients -> SourcingClientView[] ({ clientId, name, createdAt, lastUsedAt, revokedAt, allowedTools, allowedCidrs }; never the token or its hash)
 * POST /api/admin/sourcing/clients  CreateSourcingClientRequest ({ name, allowedTools?, allowedCidrs? }) -> CreateSourcingClientResponse (201)
 * Registers an MCP client (one per Accio Work workspace). The `dmsc_` bearer token is in
 * this response ONLY; just its sha256 is stored. Auth: Bearer ADMIN_TOKEN.
 */
import { CreateSourcingClientRequest } from '@/contracts/sourcing';
import { requireAdmin } from '@/server/auth/admin';
import { json, parseJson, route } from '@/server/http';
import { createSourcingClient, listSourcingClients } from '@/server/sourcing/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
    await requireAdmin(request);
    return json(await listSourcingClients());
});

export const POST = route(async (request) => {
    await requireAdmin(request);
    const body = await parseJson(request, CreateSourcingClientRequest);
    return json(await createSourcingClient(body.name, { allowedTools: body.allowedTools, allowedCidrs: body.allowedCidrs }), { status: 201 });
});
