/**
 * Stage 1 hardening: per-workspace MCP allowlist. A sourcing client can be limited to some of
 * the nine tools (hidden from tools/list, refused with TOOL_NOT_ALLOWED) and to client IP
 * ranges (403 before any tool runs; IP from the shared clientIp helper). Admin API sets both.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { SourcingClientView, SourcingToolError } from '@/contracts/sourcing';
import { ipAllowed, ipInCidr, normalizeCidr, parseIp } from '@/lib/cidr';
import { sourcingToolCalls } from '@/server/db/schema';
import { mcpRateLimiter } from '@/server/sourcing/rate-limit';
import { POST as mcpPost } from '@/app/api/mcp/sourcing/route';
import { DELETE as revokeClient } from '@/app/api/admin/sourcing/clients/[clientId]/route';
import { PUT as putAllowlist } from '@/app/api/admin/sourcing/clients/[clientId]/allowlist/route';
import { GET as listClients, POST as createClient } from '@/app/api/admin/sourcing/clients/route';
import { useTestDb as withTestDb } from '../support/db';
import { ADMIN_HEADERS, params, quietConsole, req } from './fixtures';

const ctx = withTestDb({ seed: true });
const URL_ = 'http://localhost:3100/api/mcp/sourcing';
let rpcId = 0;

async function rpc(token: string, method: string, rpcParams?: unknown, headers: Record<string, string> = {}) {
    const res = await mcpPost(
        new Request(URL_, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}`, ...headers },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(rpcParams !== undefined ? { params: rpcParams } : {}) }),
        }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function create(body: Record<string, unknown>) {
    const res = await createClient(req('/api/admin/sourcing/clients', { method: 'POST', body, headers: ADMIN_HEADERS }), params({}));
    return { status: res.status, body: await res.json() };
}

async function setAllowlist(clientId: string, body: unknown) {
    const res = await putAllowlist(req(`/api/admin/sourcing/clients/${clientId}/allowlist`, { method: 'PUT', body, headers: ADMIN_HEADERS }), params({ clientId }));
    return { status: res.status, body: await res.json() };
}

const toolNames = async (token: string, headers?: Record<string, string>) => ((await rpc(token, 'tools/list', undefined, headers)).body.result.tools as { name: string }[]).map((t) => t.name.replace('discovermake.sourcing.', ''));

beforeAll(async () => {
    quietConsole();
    await mcpRateLimiter.reset();
});

describe('CIDR helper', () => {
    it('parses and matches IPv4, IPv6 and IPv4-mapped addresses', () => {
        expect(ipInCidr('203.0.113.7', '203.0.113.0/24')).toBe(true);
        expect(ipInCidr('203.0.114.7', '203.0.113.0/24')).toBe(false);
        expect(ipInCidr('::ffff:203.0.113.7', '203.0.113.0/24')).toBe(true);
        expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
        expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
        expect(ipInCidr('2001:db8::1', '203.0.113.0/24')).toBe(false);
        expect(ipInCidr('198.51.100.4', '198.51.100.4')).toBe(true);
        expect(ipInCidr('unknown', '0.0.0.0/0')).toBe(false);
        expect(ipAllowed('anything', null)).toBe(true);
        expect(normalizeCidr('203.0.113.77/24')).toBe('203.0.113.0/24');
        expect(normalizeCidr('203.0.113.1')).toBe('203.0.113.1/32');
        expect(normalizeCidr('2001:db8::5/64')).toBe('2001:db8:0:0:0:0:0:0/64');
        for (const bad of ['300.1.1.1', '1.2.3.4/33', '1.2.3', '::1::2', 'example.com', '01.2.3.4', '1.2.3.4/']) expect(normalizeCidr(bad), bad).toBeNull();
        expect(parseIp('[2001:db8::1]')).toMatchObject({ family: 6 });
    });
});

describe('MCP allowlist', () => {
    it('creates a client with an allowlist, normalizes it and lists it (never the token)', async () => {
        const created = await create({ name: 'Read-only workspace', allowedTools: ['get_job', 'next_job', 'get_job'], allowedCidrs: ['198.51.100.77/24'] });
        expect(created.status).toBe(201);
        const list = await listClients(req('/api/admin/sourcing/clients', { headers: ADMIN_HEADERS }), params({}));
        const row = SourcingClientView.array().parse(await list.json()).find((c) => c.clientId === created.body.clientId);
        expect(row).toMatchObject({ allowedTools: ['next_job', 'get_job'], allowedCidrs: ['198.51.100.0/24'] });
        expect(JSON.stringify(row)).not.toContain(created.body.token);
    });

    it('hides tools outside the allowlist from tools/list and refuses them with TOOL_NOT_ALLOWED (audited)', async () => {
        const { body } = await create({ name: 'Lease-only workspace', allowedTools: ['next_job', 'get_job'] });
        expect(await toolNames(body.token)).toEqual(['next_job', 'get_job']);
        const refused = await rpc(body.token, 'tools/call', { name: 'discovermake.sourcing.submit_offer', arguments: {} });
        expect(refused.status).toBe(200);
        expect(refused.body.result.isError).toBe(true);
        const err = SourcingToolError.parse(refused.body.result.structuredContent).error;
        expect(err.code).toBe('TOOL_NOT_ALLOWED');
        expect(err.message).toContain('discovermake.sourcing.next_job');
        const allowed = await rpc(body.token, 'tools/call', { name: 'discovermake.sourcing.next_job', arguments: {} });
        expect(allowed.body.result.isError).toBeFalsy();
        const audit = await ctx.db
            .select()
            .from(sourcingToolCalls)
            .where(and(eq(sourcingToolCalls.clientId, body.clientId), eq(sourcingToolCalls.tool, 'discovermake.sourcing.submit_offer')));
        expect(audit).toMatchObject([{ ok: false, errorCode: 'TOOL_NOT_ALLOWED' }]);
    });

    it('accepts the token only from allowed IP ranges (rightmost x-forwarded-for hop, platform headers first)', async () => {
        const { body } = await create({ name: 'Office-only workspace', allowedCidrs: ['203.0.113.0/24', '2001:db8::/32'] });
        expect(await toolNames(body.token, { 'x-forwarded-for': '10.9.9.9, 203.0.113.50' })).toHaveLength(9);
        expect((await rpc(body.token, 'tools/list', undefined, { 'x-vercel-forwarded-for': '2001:db8::7' })).status).toBe(200);
        // A client cannot spoof its way in by prepending an allowed address.
        const spoofed = await rpc(body.token, 'tools/list', undefined, { 'x-forwarded-for': '203.0.113.50, 192.0.2.1' });
        expect(spoofed.status).toBe(403);
        expect(spoofed.body.error).toMatchObject({ code: -32003, message: expect.stringContaining('IP_NOT_ALLOWED') });
        expect((await rpc(body.token, 'tools/list')).status).toBe(403); // no IP at all
        const audit = await ctx.db.select().from(sourcingToolCalls).where(and(eq(sourcingToolCalls.clientId, body.clientId), eq(sourcingToolCalls.errorCode, 'IP_NOT_ALLOWED')));
        expect(audit.length).toBe(2);
    });

    it('admin PUT replaces the allowlist, null clears it, and bad input or revoked clients are refused', async () => {
        const { body } = await create({ name: 'Changing workspace' });
        expect(await toolNames(body.token)).toHaveLength(9);
        const narrowed = await setAllowlist(body.clientId, { allowedTools: ['complete_job'], allowedCidrs: null });
        expect(narrowed).toMatchObject({ status: 200, body: { allowedTools: ['complete_job'], allowedCidrs: null } });
        expect(await toolNames(body.token)).toEqual(['complete_job']);
        expect((await setAllowlist(body.clientId, { allowedTools: null, allowedCidrs: null })).body).toMatchObject({ allowedTools: null, allowedCidrs: null });
        expect(await toolNames(body.token)).toHaveLength(9);

        expect((await setAllowlist(body.clientId, { allowedTools: ['launch_rocket'], allowedCidrs: null })).status).toBe(400);
        expect((await setAllowlist(body.clientId, { allowedTools: [], allowedCidrs: null })).status).toBe(400);
        expect((await setAllowlist(body.clientId, { allowedTools: null, allowedCidrs: ['999.1.1.1/8'] })).status).toBe(400);
        const noAuth = await putAllowlist(req(`/api/admin/sourcing/clients/${body.clientId}/allowlist`, { method: 'PUT', body: { allowedTools: null, allowedCidrs: null } }), params({ clientId: body.clientId }));
        expect(noAuth.status).toBe(401);

        await revokeClient(req(`/api/admin/sourcing/clients/${body.clientId}`, { method: 'DELETE', headers: ADMIN_HEADERS }), params({ clientId: body.clientId }));
        expect((await setAllowlist(body.clientId, { allowedTools: null, allowedCidrs: null })).status).toBe(409);
        expect((await setAllowlist('scl_doesnotexist000000000', { allowedTools: null, allowedCidrs: null })).status).toBe(404);
    });
});
