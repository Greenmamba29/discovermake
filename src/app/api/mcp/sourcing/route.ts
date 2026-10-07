/**
 * POST /api/mcp/sourcing  — the DiscoverMake Sourcing MCP server (ADR-0005, workflow 03).
 *
 * Remote MCP over stateless Streamable HTTP with JSON responses. Accio Work (or any MCP
 * client registered with POST /api/admin/sourcing/clients) sends JSON-RPC with
 * `Authorization: Bearer dmsc_...`. Tools: discovermake.sourcing.{next_job, get_job,
 * get_attachments, submit_supplier, submit_offer, update_negotiation, attach_document,
 * request_approval, complete_job}. See src/server/sourcing/mcp.ts.
 *   401 bad/revoked token · 413 body over 8 MB · 400 malformed JSON
 * GET/DELETE answer 405 (no sessions, no SSE stream).
 */
import { handleSourcingMcpRequest, mcpMethodNotAllowed } from '@/server/sourcing/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
    return handleSourcingMcpRequest(request);
}

export async function GET(): Promise<Response> {
    return mcpMethodNotAllowed();
}

export async function DELETE(): Promise<Response> {
    return mcpMethodNotAllowed();
}
