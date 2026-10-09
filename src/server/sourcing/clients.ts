/**
 * MCP clients allowed to call the Sourcing MCP server (one per Accio Work workspace).
 *
 * Tokens are `dmsc_<43 chars>` (256 bits), shown once at creation; only their sha256 is
 * stored. Revoking a client stops its token immediately and returns its leased jobs to
 * the queue.
 *
 * Stage 1 allowlist: each client may be limited to some of the nine tools (`allowed_tools`)
 * and to client IP ranges (`allowed_cidrs`); null means no restriction. Enforced in ./mcp.ts.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { CreateSourcingClientResponse, SourcingClientAllowlist, SourcingClientView } from '../../contracts/sourcing';
import { normalizeCidr } from '../../lib/cidr';
import { generateToken, sha256Hex } from '../auth/tokens';
import { getDb, withTx } from '../db';
import { sourcingClients } from '../db/schema';
import { ApiError } from '../http';
import { SOURCING_TOKEN_PREFIX } from './constants';
import { notFound } from './errors';
import { releaseClientLeases } from './jobs';
import { SOURCING_TOOLS, type SourcingToolName } from './policy';

export type { SourcingClientView };
/** The authenticated client; the allowlist fields are absent/null when unrestricted. */
export type SourcingClientIdentity = { id: string; name: string; allowedTools?: SourcingToolName[] | null; allowedCidrs?: string[] | null };

/** Validate + canonicalize an allowlist (dedupe, tool order, normalized CIDRs). */
export function normalizeAllowlist(input: Partial<SourcingClientAllowlist>): { allowedTools: SourcingToolName[] | null; allowedCidrs: string[] | null } {
    let allowedTools: SourcingToolName[] | null = null;
    if (input.allowedTools) {
        const wanted = new Set<string>(input.allowedTools);
        allowedTools = SOURCING_TOOLS.filter((t) => wanted.has(t));
        if (allowedTools.length === 0) throw new ApiError('VALIDATION_FAILED', 'allowedTools needs at least one known tool (or null for all).');
    }
    let allowedCidrs: string[] | null = null;
    if (input.allowedCidrs) {
        const out: string[] = [];
        for (const raw of input.allowedCidrs) {
            const c = normalizeCidr(raw);
            if (!c) throw new ApiError('VALIDATION_FAILED', `"${raw.slice(0, 64)}" is not an IP address or CIDR range.`);
            if (!out.includes(c)) out.push(c);
        }
        allowedCidrs = out;
    }
    return { allowedTools, allowedCidrs };
}

export async function createSourcingClient(name: string, allowlist: Partial<SourcingClientAllowlist> = {}): Promise<CreateSourcingClientResponse> {
    const token = generateToken(SOURCING_TOKEN_PREFIX);
    const [row] = await getDb()
        .insert(sourcingClients)
        .values({ name, tokenHash: sha256Hex(token), ...normalizeAllowlist(allowlist) })
        .returning();
    return { clientId: row.id, name: row.name, token };
}

/** Replace a client's allowlist (null = unrestricted). Revoked clients cannot be changed. */
export async function updateSourcingClientAllowlist(clientId: string, allowlist: SourcingClientAllowlist): Promise<SourcingClientView> {
    const values = normalizeAllowlist(allowlist);
    const db = getDb();
    const [row] = await db
        .update(sourcingClients)
        .set(values)
        .where(and(eq(sourcingClients.id, clientId), isNull(sourcingClients.revokedAt)))
        .returning();
    if (row) return toView(row);
    const [exists] = await db.select({ id: sourcingClients.id }).from(sourcingClients).where(eq(sourcingClients.id, clientId));
    if (!exists) throw notFound('Sourcing client');
    throw new ApiError('CONFLICT', 'This client is revoked; create a new one instead.', 409);
}

/** Revoke a client (idempotent) and release its leases. */
export async function revokeSourcingClient(clientId: string, now: Date = new Date()): Promise<{ releasedJobs: number }> {
    return withTx(async (tx) => {
        const [client] = await tx.select().from(sourcingClients).where(eq(sourcingClients.id, clientId)).for('update');
        if (!client) throw notFound('Sourcing client');
        if (client.revokedAt) return { releasedJobs: 0 }; // already revoked: its leases were released then
        await tx.update(sourcingClients).set({ revokedAt: now }).where(eq(sourcingClients.id, clientId));
        return { releasedJobs: await releaseClientLeases(tx, clientId, now) };
    });
}

/** Resolve a bearer token to an active (non-revoked) client and touch `last_used_at`. */
export async function authenticateSourcingClient(token: string | null, now: Date = new Date()): Promise<SourcingClientIdentity | null> {
    if (!token || !token.startsWith(`${SOURCING_TOKEN_PREFIX}_`) || token.length > 200) return null;
    const [row] = await getDb()
        .update(sourcingClients)
        .set({ lastUsedAt: now })
        .where(and(eq(sourcingClients.tokenHash, sha256Hex(token)), isNull(sourcingClients.revokedAt)))
        .returning({ id: sourcingClients.id, name: sourcingClients.name, allowedTools: sourcingClients.allowedTools, allowedCidrs: sourcingClients.allowedCidrs });
    if (!row) return null;
    return { id: row.id, name: row.name, allowedTools: row.allowedTools ? SOURCING_TOOLS.filter((t) => row.allowedTools!.includes(t)) : null, allowedCidrs: row.allowedCidrs ?? null };
}

/** Admin view columns: never the token hash (it never leaves the auth path). */
const VIEW_COLUMNS = {
    id: sourcingClients.id,
    name: sourcingClients.name,
    createdAt: sourcingClients.createdAt,
    lastUsedAt: sourcingClients.lastUsedAt,
    revokedAt: sourcingClients.revokedAt,
    allowedTools: sourcingClients.allowedTools,
    allowedCidrs: sourcingClients.allowedCidrs,
} as const;
type ClientRow = Pick<typeof sourcingClients.$inferSelect, keyof typeof VIEW_COLUMNS>;

function toView(r: ClientRow): SourcingClientView {
    return {
        clientId: r.id,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        allowedTools: r.allowedTools ? SOURCING_TOOLS.filter((t) => r.allowedTools!.includes(t)) : null,
        allowedCidrs: r.allowedCidrs ?? null,
    };
}

/** Admin listing. Never includes the token or its hash. */
export async function listSourcingClients(): Promise<SourcingClientView[]> {
    const rows = await getDb().select(VIEW_COLUMNS).from(sourcingClients).orderBy(desc(sourcingClients.createdAt));
    return rows.map(toView);
}
