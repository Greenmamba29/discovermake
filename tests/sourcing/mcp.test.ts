/**
 * End to end over the real route handler (`/api/mcp/sourcing`) with JSON-RPC:
 * initialize -> tools/list -> next_job -> get_attachments -> submit_supplier ->
 * submit_offer -> request_approval -> complete_job, plus auth failures, tool errors
 * and the audit log.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { NextJobResult, SourcingToolError } from '@/contracts/sourcing';
import { sourcingClients, sourcingJobs, sourcingToolCalls, supplierOffers } from '@/server/db/schema';
import { leaseNextJob } from '@/server/sourcing/jobs';
import { mcpRateLimiter } from '@/server/sourcing/rate-limit';
import { DELETE as mcpDelete, GET as mcpGet, POST as mcpPost } from '@/app/api/mcp/sourcing/route';
import { DELETE as revokeClient } from '@/app/api/admin/sourcing/clients/[clientId]/route';
import { GET as listClients, POST as createClient } from '@/app/api/admin/sourcing/clients/route';
import { useTestDb } from '../support/db';
import { ADMIN_HEADERS, createJobFixture, params, quietConsole, req } from './fixtures';

const URL_ = 'http://localhost:3100/api/mcp/sourcing';
let rpcId = 0;

async function rpc(token: string | null, method: string, rpcParams?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await mcpPost(
        new Request(URL_, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                'mcp-protocol-version': '2025-06-18',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...extraHeaders,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(rpcParams !== undefined ? { params: rpcParams } : {}) }),
        }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

type ToolResult = { isError?: boolean; structuredContent: Record<string, unknown>; content: { type: string; text: string }[] };

async function call(token: string, name: string, args: unknown): Promise<ToolResult> {
    const r = await rpc(token, 'tools/call', { name: `discovermake.sourcing.${name}`, arguments: args });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.error, JSON.stringify(r.body.error)).toBeUndefined();
    const result = r.body.result as ToolResult;
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    return result;
}

describe('Sourcing MCP server (route handler, JSON-RPC)', () => {
    const ctx = useTestDb({ seed: true });
    let token = '';
    let clientId = '';
    beforeAll(async () => {
        quietConsole();
        mcpRateLimiter.reset();
        const res = await createClient(req('/api/admin/sourcing/clients', { method: 'POST', body: { name: 'Accio Work · DiscoverMake' }, headers: ADMIN_HEADERS }), params({}));
        expect(res.status).toBe(201);
        const body = await res.json();
        token = body.token;
        clientId = body.clientId;
    });

    it('issues dmsc_ tokens stored only as sha256, and lists clients without secrets', async () => {
        expect(token).toMatch(/^dmsc_[A-Za-z0-9_-]{43}$/);
        const [row] = await ctx.db.select().from(sourcingClients).where(eq(sourcingClients.id, clientId));
        expect(row.tokenHash).not.toContain(token);
        expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        const list = await listClients(req('/api/admin/sourcing/clients', { headers: ADMIN_HEADERS }), params({}));
        const raw = await list.text();
        expect(raw).not.toContain(token);
        expect(raw).not.toContain(row.tokenHash);
        expect(JSON.parse(raw)[0]).toEqual({ clientId, name: 'Accio Work · DiscoverMake', createdAt: expect.any(String), lastUsedAt: null, revokedAt: null, allowedTools: null, allowedCidrs: null });
        expect((await createClient(req('/api/admin/sourcing/clients', { method: 'POST', body: { name: 'x' } }), params({}))).status).toBe(401);
    });

    it('rejects missing, wrong and revoked tokens with 401', async () => {
        const none = await rpc(null, 'tools/list');
        expect(none.status).toBe(401);
        expect(none.headers.get('www-authenticate')).toMatch(/^Bearer/);
        expect(none.body.error.code).toBe(-32001);
        expect((await rpc('dmsc_not-a-real-token-000000000000000000000000000', 'tools/list')).status).toBe(401);
        expect((await rpc('test-admin-token', 'tools/list')).status).toBe(401);

        const res = await createClient(req('/api/admin/sourcing/clients', { method: 'POST', body: { name: 'temp' }, headers: ADMIN_HEADERS }), params({}));
        const temp = await res.json();
        expect((await rpc(temp.token, 'tools/list')).status).toBe(200);
        const del = await revokeClient(req(`/api/admin/sourcing/clients/${temp.clientId}`, { method: 'DELETE', headers: ADMIN_HEADERS }), params({ clientId: temp.clientId }));
        expect(del.status).toBe(200);
        expect((await rpc(temp.token, 'tools/list')).status).toBe(401);
        expect((await mcpGet()).status).toBe(405);
        expect((await mcpDelete()).status).toBe(405);
    });

    it('runs a whole job over MCP: initialize, tools/list, next_job ... complete_job', async () => {
        const { job, part } = await createJobFixture(ctx.db, { priority: 100 });

        const init = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'accio-work', version: '1.0' } });
        expect(init.status).toBe(200);
        expect(init.headers.get('mcp-session-id')).toBeNull();
        expect(init.body.result.serverInfo.name).toBe('discovermake-sourcing');
        expect(init.body.result.capabilities.tools).toBeDefined();
        expect(init.body.result.instructions).toMatch(/Approval boundary/);

        const list = await rpc(token, 'tools/list');
        const tools = list.body.result.tools as { name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }[];
        expect(tools.map((t) => t.name).sort()).toEqual(
            ['next_job', 'get_job', 'get_attachments', 'submit_supplier', 'submit_offer', 'update_negotiation', 'attach_document', 'request_approval', 'complete_job'].map((n) => `discovermake.sourcing.${n}`).sort(),
        );
        for (const t of tools) expect(t.description.length).toBeGreaterThan(150);
        const submitOfferTool = tools.find((t) => t.name === 'discovermake.sourcing.submit_offer')!;
        expect(Object.keys(submitOfferTool.inputSchema.properties)).toEqual(expect.arrayContaining(['unit_price_cents', 'design_version', 'idempotency_key', 'negotiation_status']));
        expect(submitOfferTool.description).toMatch(/SUPPLIER_CONFIRMED/);

        // next_job
        const next = await call(token, 'next_job', {});
        const leased = NextJobResult.parse(next.structuredContent);
        expect(leased.job?.sourcing_request_id).toBe(job.id);
        const lease = { sourcing_request_id: job.id, lease_id: leased.lease_id! };

        // get_job
        const got = await call(token, 'get_job', { sourcing_request_id: job.id });
        expect(got.structuredContent).toMatchObject({ status: 'LEASED', is_stale: false, offers: [], approvals: [] });

        // get_attachments (REDACTED) then FULL without approval
        const att = await call(token, 'get_attachments', lease);
        expect((att.structuredContent.attachments as { name: string }[]).map((a) => a.name).sort()).toEqual(['preview.svg', 'request-sheet.txt']);

        // submit_supplier
        const sup = await call(token, 'submit_supplier', {
            ...lease,
            name: 'Da Nang Sheet Metal Co.',
            platform: 'alibaba',
            platform_ref: 'dnsm-001',
            country: 'VN',
            verified: true,
            evidence: [{ kind: 'platform_profile', url: 'https://example.com/dnsm', note: 'Gold supplier, 6 years' }],
        });
        expect(sup.isError).toBeUndefined();
        const supplierId = sup.structuredContent.supplier_id as string;
        expect(supplierId).toMatch(/^sup_/);

        const full = await call(token, 'get_attachments', { ...lease, tier: 'FULL', supplier_id: supplierId });
        expect(full.isError).toBe(true);
        expect(SourcingToolError.parse(full.structuredContent).error).toMatchObject({ code: 'APPROVAL_REQUIRED', approval_kind: 'RELEASE_FULL_PACKAGE' });

        // submit_offer (+ idempotent retry, + stale version, + validation error)
        const offerArgs = {
            ...lease,
            idempotency_key: `${supplierId}-r1`,
            supplier_id: supplierId,
            design_version: 1,
            quantity: 10,
            unit_price_cents: 680,
            shipping_cents: 2400,
            moq: 10,
            production_lead_days: 12,
            shipping_lead_days: 7,
            incoterm: 'DDP',
            material: 'Aluminum 5052-H32, 1.6 mm',
            processes: ['Fiber laser cutting'],
            confidence: 0.88,
            negotiation_status: 'supplier-confirmed',
        };
        const offer = await call(token, 'submit_offer', offerArgs);
        expect(offer.structuredContent).toMatchObject({ trust_level: 'SUPPLIER_CONFIRMED', status: 'ACTIVE', exceptions: [], duplicate: false });
        const retry = await call(token, 'submit_offer', offerArgs);
        expect(retry.structuredContent).toMatchObject({ supplier_offer_id: offer.structuredContent.supplier_offer_id, duplicate: true });
        const stale = await call(token, 'submit_offer', { ...offerArgs, idempotency_key: 'stale-version-01', design_version: 9 });
        expect(SourcingToolError.parse(stale.structuredContent).error.code).toBe('STALE_DESIGN_VERSION');
        const invalid = await call(token, 'submit_offer', { ...offerArgs, unit_price_cents: 6.8 });
        expect(invalid.isError).toBe(true);
        expect(SourcingToolError.parse(invalid.structuredContent).error).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect((invalid.structuredContent.error as { message: string }).message).toContain('unit_price_cents');
        expect(await ctx.db.select().from(supplierOffers).where(eq(supplierOffers.jobId, job.id))).toHaveLength(1);

        // update_negotiation + attach_document
        const neg = await call(token, 'update_negotiation', { ...lease, supplier_id: supplierId, status: 'supplier-confirmed', note: 'Confirmed $6.80/pc DDP' });
        expect(neg.structuredContent).toMatchObject({ status: 'supplier-confirmed', note_count: 1 });
        const doc = await call(token, 'attach_document', {
            ...lease,
            supplier_id: supplierId,
            kind: 'QUOTE',
            filename: 'quote.txt',
            content_type: 'text/plain',
            content_base64: Buffer.from('Unit price USD 6.80, DDP').toString('base64'),
        });
        expect(doc.structuredContent.document_id).toMatch(/^sdoc_/);

        // request_approval (the agent asks; it cannot decide)
        const appr = await call(token, 'request_approval', {
            ...lease,
            kind: 'SELECT_SUPPLIER_OFFER',
            supplier_offer_id: offer.structuredContent.supplier_offer_id,
            reason: 'Confirmed, fastest DDP option',
            details: { totalCents: 680 * 10 + 2400 },
        });
        expect(appr.structuredContent).toMatchObject({ kind: 'SELECT_SUPPLIER_OFFER', status: 'PENDING', approver_role: 'customer', created: true });

        // complete_job
        const done = await call(token, 'complete_job', { ...lease, outcome: 'offers_submitted', summary: 'One supplier-confirmed DDP offer from Vietnam; selection pending.' });
        expect(done.structuredContent).toMatchObject({ status: 'COMPLETE', outcome: 'offers_submitted', offer_count: 1 });
        const [row] = await ctx.db.select().from(sourcingJobs).where(eq(sourcingJobs.id, job.id));
        expect(row.status).toBe('COMPLETE');

        // The lease is over; the job is still readable by its last leaseholder.
        const after = await call(token, 'submit_supplier', { ...lease, name: 'Late', platform: 'other', country: 'CN', verified: false });
        expect(SourcingToolError.parse(after.structuredContent).error.code).toBe('LEASE_INVALID');
        expect((await call(token, 'get_job', { sourcing_request_id: job.id })).structuredContent.status).toBe('COMPLETE');

        // Nothing touched the part's engineering fields.
        expect(part.designVersion).toBe(1);

        // Audit: every tools/call is logged with an args hash, never raw args.
        const calls = await ctx.db.select().from(sourcingToolCalls).where(eq(sourcingToolCalls.clientId, clientId));
        expect(calls.length).toBeGreaterThanOrEqual(14);
        expect(calls.every((c) => /^[0-9a-f]{64}$/.test(c.argsSha256))).toBe(true);
        expect(calls.find((c) => c.errorCode === 'APPROVAL_REQUIRED')?.tool).toBe('discovermake.sourcing.get_attachments');
        expect(calls.filter((c) => c.ok && c.jobId === job.id).length).toBeGreaterThanOrEqual(10);
        const [touched] = await ctx.db.select().from(sourcingClients).where(eq(sourcingClients.id, clientId));
        expect(touched.lastUsedAt).not.toBeNull();
    });

    it('returns tool errors for unknown tools, empty queues and other clients\' jobs', async () => {
        const unknown = await call(token, 'place_order', { sourcing_request_id: 'src_x' });
        expect(SourcingToolError.parse(unknown.structuredContent).error.code).toBe('NOT_FOUND');
        // drain, then the queue is empty
        while ((await leaseNextJob(clientId)).job) {
            /* drain */
        }
        const empty = await call(token, 'next_job', {});
        expect(empty.structuredContent).toEqual({ job: null, lease_id: null, lease_expires_at: null });

        const { job } = await createJobFixture(ctx.db, { priority: 100 });
        const res = await createClient(req('/api/admin/sourcing/clients', { method: 'POST', body: { name: 'other' }, headers: ADMIN_HEADERS }), params({}));
        const other = await res.json();
        const theirs = NextJobResult.parse((await call(other.token, 'next_job', {})).structuredContent);
        expect(theirs.job?.sourcing_request_id).toBe(job.id);
        const peek = await call(token, 'get_job', { sourcing_request_id: job.id });
        expect(SourcingToolError.parse(peek.structuredContent).error.code).toBe('NOT_FOUND');
        const hijack = await call(token, 'complete_job', { sourcing_request_id: job.id, lease_id: theirs.lease_id, outcome: 'no_viable_suppliers', summary: 'not mine' });
        expect(SourcingToolError.parse(hijack.structuredContent).error.code).toBe('LEASE_INVALID');
    });

    it('caps the body at 8 MB, rejects malformed JSON, and rate limits per client', async () => {
        const huge = await mcpPost(
            new Request(URL_, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': String(9 * 1024 * 1024) },
                body: 'x',
            }),
        );
        expect(huge.status).toBe(413);
        const bad = await mcpPost(new Request(URL_, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{not json' }));
        expect(bad.status).toBe(400);
        // A client that only accepts application/json still gets an answer.
        const jsonOnly = await rpc(token, 'tools/list', undefined, { accept: 'application/json' });
        expect(jsonOnly.status).toBe(200);

        for (let i = 0; i < 80; i++) await mcpRateLimiter.take(clientId);
        const limited = await call(token, 'next_job', {});
        expect(SourcingToolError.parse(limited.structuredContent).error.code).toBe('RATE_LIMITED');
        // Unknown tool names spend budget too (each still writes an audit row): no unlimited spam.
        const unknown = await call(token, 'definitely_not_a_tool', {});
        expect(SourcingToolError.parse(unknown.structuredContent).error.code).toBe('RATE_LIMITED');
        await mcpRateLimiter.reset();
    });
});
