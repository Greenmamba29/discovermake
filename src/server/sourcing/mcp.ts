/**
 * The DiscoverMake Sourcing MCP server (ADR-0005, workflow 03): Accio Work's agent group
 * calls these tools on a schedule (inverted control: Accio has no inbound API).
 *
 * Transport: stateless Streamable HTTP (no session ids) with JSON responses, built on
 * `WebStandardStreamableHTTPServerTransport`; one McpServer + transport per request.
 * Auth: `Authorization: Bearer dmsc_...` checked against `sourcing_clients.token_hash`
 * (revoked clients excluded). Body cap 8 MB. Per-client token bucket (shared store, see
 * ./rate-limit.ts). Every `tools/call` is written to `sourcing_tool_calls` (args sha256 only).
 * Per-workspace allowlist (Stage 1): a client's `allowed_cidrs` is checked against the request
 * IP (the shared `clientIp` helper: platform header, else the rightmost x-forwarded-for hop)
 * before anything else (403, JSON-RPC -32003); tools outside `allowed_tools` are left out of
 * tools/list and refused on call with TOOL_NOT_ALLOWED.
 *
 * Tool calls are dispatched by `callSourcingTool` instead of the SDK's built-in handler,
 * so that argument errors come back as `SourcingToolError` bodies (VALIDATION_FAILED)
 * and are audited like any other call; `registerTool` still provides `tools/list` with
 * the JSON Schemas generated from the frozen zod contracts.
 *
 * There is no tool that writes a Build's engineering fields (geometry, material,
 * tolerance), places orders, pays, or decides approvals: see ./policy.ts TOOL_ACTIONS.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { asc, eq } from 'drizzle-orm';
import { z, type ZodError } from 'zod';
import { SourcingJobId } from '../../contracts/common';
import {
    AttachDocumentInput,
    CompleteJobInput,
    GetAttachmentsInput,
    GetJobInput,
    NextJobInput,
    RequestApprovalInput,
    SubmitOfferInput,
    SubmitSupplierInput,
    UpdateNegotiationInput,
    type NextJobResult,
    type SourcingErrorCode,
    type SourcingToolError,
} from '../../contracts/sourcing';
import { bearerToken } from '../auth/tokens';
import { getDb } from '../db';
import { approvals } from '../db/schema';
import { ApiError, readBodyBytes } from '../http';
import { requestApproval } from './approvals';
import { getAttachments } from './attachments';
import { argsSha256, recordToolCall } from './audit';
import { relayOutboxLazily } from './auto-request';
import { authenticateSourcingClient, type SourcingClientIdentity } from './clients';
import { ipAllowed } from '../../lib/cidr';
import { clientIp } from '../make-ai/rate-limit';
import { MCP_MAX_BODY_BYTES } from './constants';
import { attachDocument } from './documents';
import { SourcingError } from './errors';
import { completeJob, currentDesignVersion, getJobForClient, leaseNextJob, type JobWriter } from './jobs';
import { updateNegotiation } from './negotiations';
import { agentOfferSummaries, submitOffer } from './offers';
import { SOURCING_TOOLS, type SourcingToolName } from './policy';
import { mcpRateLimiter } from './rate-limit';
import { submitSupplier } from './suppliers';

export const MCP_SERVER_NAME = 'discovermake-sourcing';
export const MCP_SERVER_VERSION = '2.0.0';
export const TOOL_PREFIX = 'discovermake.sourcing.';

export const toolName = (short: SourcingToolName) => `${TOOL_PREFIX}${short}`;

const BOUNDARY_TEXT =
    'Approval boundary: you may search suppliers, register them, contact and negotiate within the job bounds, keep notes, attach documents, fetch the REDACTED package, submit offers, request approvals and complete jobs. ' +
    'Only humans in DiscoverMake may release the FULL design package to a supplier, approve samples (unless the job allows them), pay deposits, place purchase orders, approve tooling, start production, accept material substitutions or tolerance changes, change compliance requirements, or select the winning offer. ' +
    'Never promise any of these to a supplier. When one is needed, call discovermake.sourcing.request_approval; tools answer APPROVAL_REQUIRED (with approval_kind) when you reach the boundary.';

export const SERVER_INSTRUCTIONS = [
    'DiscoverMake Sourcing: you are the procurement department for DiscoverMake builds. Work one job at a time:',
    '1. next_job leases the next sourcing request (30-minute lease, extended by every write). No job -> stop until the next schedule.',
    '2. get_job / get_attachments (REDACTED package: request sheet + 2D preview) give you the spec to send in RFQs.',
    '3. submit_supplier for every credible candidate (with evidence), update_negotiation as threads progress, attach_document for quotes/certificates.',
    '4. submit_offer with a normalized offer in integer US cents against the job\'s exact design_version; use a stable idempotency_key per supplier quote revision.',
    '5. complete_job when done (offers_submitted, no_viable_suppliers, or needs_desk to hand it to DiscoverMake ops).',
    'Errors come back as isError results whose structuredContent is { error: { code, message, approval_kind? } }. LEASE_INVALID: stop and call next_job. STALE_DESIGN_VERSION: stop work on the job.',
    BOUNDARY_TEXT,
].join('\n');

// ---------------------------------------------------------------------------
// Tool table
// ---------------------------------------------------------------------------

export type ToolContext = { client: SourcingClientIdentity };

type ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
    title: string;
    description: string;
    input: S;
    readOnly: boolean;
    run: (args: z.output<S>, ctx: ToolContext) => Promise<Record<string, unknown>>;
};

const agentWriter = (ctx: ToolContext, leaseId: string): JobWriter => ({ kind: 'agent', clientId: ctx.client.id, leaseId });
/** The lease travels in the writer; services take the remaining arguments. */
const stripLease = <T extends { lease_id: string }>(args: T): Omit<T, 'lease_id'> => {
    const rest: Partial<T> = { ...args };
    delete rest.lease_id;
    return rest as Omit<T, 'lease_id'>;
};

function defineTool<S extends z.ZodTypeAny>(def: ToolDef<S>): ToolDef {
    return def as unknown as ToolDef;
}

export const TOOL_DEFS: Record<SourcingToolName, ToolDef> = {
    next_job: defineTool({
        title: 'Lease the next sourcing job',
        description:
            'Lease the next queued DiscoverMake sourcing request. Returns { job, lease_id, lease_expires_at }; job is null when the queue is empty (stop and wait for the next scheduled run). ' +
            'The lease lasts 30 minutes and every write with this lease_id extends it; if it expires the job returns to the queue and your lease_id stops working (LEASE_INVALID). ' +
            'Optionally pass processes (e.g. ["CNC milling"]) to only take jobs that need one of them. job.approval_policy tells you what you may do without a human: ' +
            'max_unit_price_cents and max_total_lead_days are negotiation bounds (offers outside them are still accepted but flagged for review). ' +
            BOUNDARY_TEXT,
        input: NextJobInput,
        readOnly: false,
        run: async (args: z.output<typeof NextJobInput>, ctx) => {
            await relayOutboxLazily();
            const lease = await leaseNextJob(ctx.client.id, { processes: args.processes });
            const result: NextJobResult = {
                job: lease.job?.request ?? null,
                lease_id: lease.leaseId,
                lease_expires_at: lease.leaseExpiresAt?.toISOString() ?? null,
            };
            return result;
        },
    }),
    get_job: defineTool({
        title: 'Read a sourcing job',
        description:
            'Read a sourcing request you have leased: the full SourcingRequest (material, processes, dimensions in mm, tolerances, finish, quantity, target date, approval_policy), its status, ' +
            'the offers submitted so far (trust level, status, total in cents, exceptions) and the approvals you requested with their decisions. ' +
            'Use it to check whether a requested approval (e.g. RELEASE_FULL_PACKAGE for a supplier) has been APPROVED before acting on it. is_stale = true means the design changed: stop work on this job.',
        input: GetJobInput,
        readOnly: true,
        run: async (args: z.output<typeof GetJobInput>, ctx) => {
            const job = await getJobForClient(args.sourcing_request_id, ctx.client.id);
            const current = await currentDesignVersion(getDb(), job);
            const rows = await getDb().select().from(approvals).where(eq(approvals.jobId, job.id)).orderBy(asc(approvals.createdAt));
            return {
                job: job.request,
                status: job.status,
                channel: job.channel,
                lease_expires_at: job.leaseId ? (job.leaseExpiresAt?.toISOString() ?? null) : null,
                current_design_version: current,
                is_stale: current !== job.designVersion,
                offers: await agentOfferSummaries(job),
                approvals: rows.map((a) => ({
                    approval_id: a.id,
                    kind: a.kind,
                    status: a.status,
                    supplier_id: a.supplierId,
                    supplier_offer_id: a.supplierOfferId,
                    decision_note: a.decisionNote,
                })),
            };
        },
    }),
    get_attachments: defineTool({
        title: 'Get signed package URLs',
        description:
            'Get signed download URLs (valid 15 minutes, every access is logged) for the technical package of a leased job. ' +
            'tier "REDACTED" (default) = request sheet + 2D flat-pattern preview SVG: safe to send to any supplier in an RFQ. ' +
            'tier "FULL" adds the confidential source CAD and is only allowed for a supplier_id with an APPROVED RELEASE_FULL_PACKAGE approval; otherwise the tool returns APPROVAL_REQUIRED. ' +
            'Never forward FULL files to any other supplier. Download the files promptly; call again for fresh URLs.',
        input: GetAttachmentsInput,
        readOnly: true,
        run: async (args: z.output<typeof GetAttachmentsInput>, ctx) => ({ attachments: await getAttachments(args, ctx.client.id) }),
    }),
    submit_supplier: defineTool({
        title: 'Register a candidate supplier',
        description:
            'Register a candidate supplier you found for a leased job, with evidence (platform profile, Verified Supplier badge, certificates, factory photos, transaction history). ' +
            'Pass the platform and its own supplier id/handle as platform_ref: suppliers are de-duplicated on (platform, platform_ref), so registering the same storefront again returns the same supplier_id. ' +
            'country is ISO 3166-1 alpha-2 (CN, VN, US...). verified = the platform\'s own verification (e.g. Alibaba Verified Supplier), not your opinion. Returns { supplier_id, created }.',
        input: SubmitSupplierInput,
        readOnly: false,
        run: async (args: z.output<typeof SubmitSupplierInput>, ctx) => {
            const { supplier, created } = await submitSupplier(stripLease(args), agentWriter(ctx, args.lease_id));
            return { supplier_id: supplier.id, created };
        },
    }),
    submit_offer: defineTool({
        title: 'Submit a normalized supplier offer',
        description:
            'Submit one normalized supplier quote for a leased job. All money is integer US cents (convert: $16.80 -> 1680; CNY/EUR converted to USD at the day\'s rate, stated in exceptions if material). ' +
            'design_version must equal the job\'s design_version (else STALE_DESIGN_VERSION). Use a stable idempotency_key per supplier quote revision (e.g. "<supplier_id>-r1"): retries return the first offer. ' +
            'List every deviation from the request in exceptions (substituted material, relaxed tolerance, different finish, partial quantity). ' +
            'Trust: the offer is SUPPLIER_CONFIRMED only if negotiation_status is "supplier-confirmed" (the supplier confirmed price and lead time against this exact design version and package) AND there are no exceptions; otherwise it is a SUPPLIER_ESTIMATE. ' +
            'Offers above max_unit_price_cents or max_total_lead_days are stored but flagged in exceptions. Submitting an offer never commits anyone: purchase, deposits and tooling are human decisions. ' +
            'Returns { supplier_offer_id, trust_level, status, exceptions, duplicate }.',
        input: SubmitOfferInput,
        readOnly: false,
        run: async (args: z.output<typeof SubmitOfferInput>, ctx) => {
            const { offer, duplicate } = await submitOffer(stripLease(args), agentWriter(ctx, args.lease_id));
            return { supplier_offer_id: offer.id, trust_level: offer.trustLevel, status: offer.status, exceptions: offer.exceptions, duplicate };
        },
    }),
    update_negotiation: defineTool({
        title: 'Update a negotiation thread',
        description:
            'Record the status of your thread with one supplier on a leased job (contacted, rfq-sent, awaiting-reply, negotiating, supplier-estimate, supplier-confirmed, declined, no-response) and append a note: ' +
            'what you asked, what they answered, what is still open. Negotiate only within the job\'s approval_policy bounds; agreeing to purchase, deposits, tooling, samples (unless allowed) or engineering changes is outside the boundary. ' +
            'Returns { negotiation_id, status, note_count }.',
        input: UpdateNegotiationInput,
        readOnly: false,
        run: async (args: z.output<typeof UpdateNegotiationInput>, ctx) => {
            const row = await updateNegotiation(stripLease(args), agentWriter(ctx, args.lease_id));
            return { negotiation_id: row.id, status: row.status, note_count: row.notes.length };
        },
    }),
    attach_document: defineTool({
        title: 'Attach a supplier document',
        description:
            'Attach a document received from a supplier to a leased job: formal quote, drawing returned with comments, certificate, sample photo, invoice. ' +
            'content_base64 is the file body in standard base64 (max 5 MB decoded); content_type must match the real file (PDF, PNG, JPEG, WebP, plain text, CSV) or the call fails. ' +
            'Reference returned document ids in submit_offer.attachment_ids. Returns { document_id, sha256, size_bytes }.',
        input: AttachDocumentInput,
        readOnly: false,
        run: async (args: z.output<typeof AttachDocumentInput>, ctx) => {
            const doc = await attachDocument(stripLease(args), agentWriter(ctx, args.lease_id));
            return { document_id: doc.id, sha256: doc.sha256, size_bytes: doc.sizeBytes };
        },
    }),
    request_approval: defineTool({
        title: 'Ask a human to decide',
        description:
            'Ask a human in DiscoverMake to decide something outside your boundary, for a leased job: RELEASE_FULL_PACKAGE (needs supplier_id), REQUEST_SAMPLE (supplier_id), PAY_DEPOSIT, PLACE_PURCHASE_ORDER, APPROVE_TOOLING, START_PRODUCTION, ' +
            'ACCEPT_MATERIAL_SUBSTITUTION, ACCEPT_TOLERANCE_CHANGE, CHANGE_COMPLIANCE, or SELECT_SUPPLIER_OFFER (needs supplier_offer_id). Explain why in reason and put the facts (amounts in cents, dates, supplier terms) in details. ' +
            'The approval is created PENDING; you cannot decide it and must not act until get_job shows it APPROVED. Even then, deposits, purchase orders, tooling, production and offer selection are executed by humans inside DiscoverMake, never by you. ' +
            'Asking twice for the same thing returns the pending approval. Returns { approval_id, kind, status, approver_role, created }.',
        input: RequestApprovalInput,
        readOnly: false,
        run: async (args: z.output<typeof RequestApprovalInput>, ctx) => {
            const { approval, created } = await requestApproval(stripLease(args), agentWriter(ctx, args.lease_id));
            return { approval_id: approval.id, kind: approval.kind, status: approval.status, approver_role: approval.approverRole, created };
        },
    }),
    complete_job: defineTool({
        title: 'Complete a sourcing job',
        description:
            'Close a leased job with an outcome and a summary for DiscoverMake ops (suppliers contacted, offers submitted, open questions). ' +
            '"offers_submitted" needs at least one submit_offer; "no_viable_suppliers" when nobody can make it within the request; "needs_desk" hands the job to DiscoverMake\'s human sourcing desk (use it when you are stuck or the job needs a decision you cannot request). ' +
            'Your lease ends either way. Returns { sourcing_request_id, status, outcome, offer_count }.',
        input: CompleteJobInput,
        readOnly: false,
        run: async (args: z.output<typeof CompleteJobInput>, ctx) => {
            const { job, offerCount } = await completeJob(stripLease(args), agentWriter(ctx, args.lease_id));
            return { sourcing_request_id: job.id, status: job.status, outcome: args.outcome, offer_count: offerCount };
        },
    }),
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function toolErrorResult(body: SourcingToolError): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: true };
}

function okResult(data: Record<string, unknown>): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

function zodMessage(err: ZodError): string {
    return err.issues
        .slice(0, 10)
        .map((i) => `${i.path.join('.') || '(arguments)'}: ${i.message}`)
        .join('; ');
}

function shortName(name: string): SourcingToolName | null {
    if (!name.startsWith(TOOL_PREFIX)) return null;
    const short = name.slice(TOOL_PREFIX.length);
    return (SOURCING_TOOLS as readonly string[]).includes(short) ? (short as SourcingToolName) : null;
}

/** The tools this client may list and call (all nine when it has no allowlist). */
export function allowedTools(client: Pick<SourcingClientIdentity, 'allowedTools'>): readonly SourcingToolName[] {
    return client.allowedTools ? SOURCING_TOOLS.filter((t) => client.allowedTools!.includes(t)) : SOURCING_TOOLS;
}

function toolAllowed(client: Pick<SourcingClientIdentity, 'allowedTools'>, short: SourcingToolName): boolean {
    return !client.allowedTools || client.allowedTools.includes(short);
}

function jobIdOf(args: unknown): string | null {
    const id = (args as { sourcing_request_id?: unknown } | null)?.sourcing_request_id;
    return typeof id === 'string' && SourcingJobId.safeParse(id).success ? id : null;
}

/**
 * Run one tool call: rate limit -> validate -> run -> audit. Domain errors become
 * `isError` results with a `SourcingToolError` body; unexpected errors are logged and
 * surface as a JSON-RPC internal error without details.
 */
export async function callSourcingTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<CallToolResult> {
    const started = Date.now();
    let ok = false;
    let errorCode: SourcingErrorCode | 'INTERNAL' | null = null;
    const fail = (code: SourcingErrorCode, message: string, approvalKind?: SourcingToolError['error']['approval_kind']) => {
        errorCode = code;
        return toolErrorResult({ error: { code, message, ...(approvalKind ? { approval_kind: approvalKind } : {}) } });
    };
    try {
        const short = shortName(name);
        if (!short) return fail('NOT_FOUND', `Unknown tool ${name.slice(0, 100)}. Tools: ${SOURCING_TOOLS.map(toolName).join(', ')}`);
        if (!toolAllowed(ctx.client, short)) {
            return fail('TOOL_NOT_ALLOWED', `${toolName(short)} is not enabled for this workspace. Allowed tools: ${allowedTools(ctx.client).map(toolName).join(', ')}. Ask DiscoverMake ops to change the allowlist.`);
        }
        const budget = await mcpRateLimiter.take(ctx.client.id);
        if (!budget.allowed) return fail('RATE_LIMITED', `Too many calls. Retry in ${budget.retryAfterSeconds} s.`);
        const def = TOOL_DEFS[short];
        const parsed = def.input.safeParse(rawArgs ?? {});
        if (!parsed.success) return fail('VALIDATION_FAILED', `Invalid arguments: ${zodMessage(parsed.error)}`);
        const data = await def.run(parsed.data, ctx);
        ok = true;
        return okResult(data);
    } catch (err) {
        if (err instanceof SourcingError) return fail(err.sourcingCode, err.message, err.approvalKind);
        errorCode = 'INTERNAL';
        console.error(`[sourcing] tool ${name} failed`, err);
        throw new McpError(ErrorCode.InternalError, 'Internal error');
    } finally {
        await recordToolCall({
            clientId: ctx.client.id,
            tool: name,
            jobId: jobIdOf(rawArgs),
            ok,
            errorCode,
            argsSha256: argsSha256(rawArgs),
            durationMs: Date.now() - started,
        });
    }
}

/** A fresh McpServer for one request (stateless), with the 9 tools registered for the authenticated client. */
export function createSourcingMcpServer(ctx: ToolContext): McpServer {
    const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
    for (const short of allowedTools(ctx.client)) {
        const def = TOOL_DEFS[short];
        server.registerTool(
            toolName(short),
            {
                title: def.title,
                description: def.description,
                inputSchema: def.input,
                annotations: { title: def.title, readOnlyHint: def.readOnly, destructiveHint: false, idempotentHint: def.readOnly, openWorldHint: false },
            },
            async (args: unknown) => callSourcingTool(toolName(short), args, ctx),
        );
    }
    // Replace the SDK's tools/call handler (see the module header): same tools, our validation + audit.
    server.server.setRequestHandler(CallToolRequestSchema, async (request) => callSourcingTool(request.params.name, request.params.arguments, ctx));
    return server;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
    });
}

/** GET (SSE stream) and DELETE (session end) do not exist in stateless mode. */
export function mcpMethodNotAllowed(): Response {
    return jsonRpcError(405, -32000, 'Method not allowed: this MCP server is stateless; POST JSON-RPC messages.', { allow: 'POST' });
}

/** Handle one MCP Streamable HTTP POST. */
export async function handleSourcingMcpRequest(request: Request): Promise<Response> {
    const client = await authenticateSourcingClient(bearerToken(request.headers));
    if (!client) {
        return jsonRpcError(401, -32001, 'Unauthorized: send Authorization: Bearer <token from POST /api/admin/sourcing/clients>', {
            'www-authenticate': 'Bearer realm="discovermake-sourcing"',
        });
    }
    const ip = clientIp(request);
    if (!ipAllowed(ip, client.allowedCidrs)) {
        await recordToolCall({ clientId: client.id, tool: '(request)', jobId: null, ok: false, errorCode: 'IP_NOT_ALLOWED', argsSha256: argsSha256(null), durationMs: 0 });
        return jsonRpcError(403, -32003, 'Forbidden: IP_NOT_ALLOWED: this workspace token is not accepted from your IP address. Ask DiscoverMake ops to update the allowlist.');
    }

    let body: unknown;
    try {
        const bytes = await readBodyBytes(request, MCP_MAX_BODY_BYTES);
        body = JSON.parse(new TextDecoder().decode(bytes));
    } catch (err) {
        if (err instanceof ApiError && err.code === 'PAYLOAD_TOO_LARGE') return jsonRpcError(413, -32000, `Request body exceeds ${MCP_MAX_BODY_BYTES} bytes`);
        return jsonRpcError(400, -32700, 'Parse error: invalid JSON');
    }

    // We always answer with JSON; accept clients that only advertise application/json.
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const accept = headers.get('accept') ?? '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) headers.set('accept', 'application/json, text/event-stream');
    const forwarded = new Request(request.url, { method: 'POST', headers });

    const ctx: ToolContext = { client };
    const server = createSourcingMcpServer(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
        const res = await transport.handleRequest(forwarded, { parsedBody: body, authInfo: { token: 'redacted', clientId: client.id, scopes: ['sourcing'] } });
        const out = new Headers(res.headers);
        out.set('cache-control', 'no-store');
        return new Response(res.body, { status: res.status, headers: out });
    } finally {
        await server.close();
    }
}
