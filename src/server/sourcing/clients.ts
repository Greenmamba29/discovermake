/**
 * MCP clients allowed to call the Sourcing MCP server (one per Accio Work workspace).
 *
 * Tokens are `dmsc_<43 chars>` (256 bits), shown once at creation; only their sha256 is
 * stored. Revoking a client stops its token immediately and returns its leased jobs to
 * the queue.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { CreateSourcingClientResponse } from '../../contracts/sourcing';
import { generateToken, sha256Hex } from '../auth/tokens';
import { getDb, withTx } from '../db';
import { sourcingClients } from '../db/schema';
import { SOURCING_TOKEN_PREFIX } from './constants';
import { notFound } from './errors';
import { releaseClientLeases } from './jobs';

export type SourcingClientIdentity = { id: string; name: string };

export async function createSourcingClient(name: string): Promise<CreateSourcingClientResponse> {
    const token = generateToken(SOURCING_TOKEN_PREFIX);
    const [row] = await getDb().insert(sourcingClients).values({ name, tokenHash: sha256Hex(token) }).returning();
    return { clientId: row.id, name: row.name, token };
}

/** Revoke a client (idempotent) and release its leases. */
export async function revokeSourcingClient(clientId: string, now: Date = new Date()): Promise<{ releasedJobs: number }> {
    return withTx(async (tx) => {
        const [client] = await tx.select().from(sourcingClients).where(eq(sourcingClients.id, clientId)).for('update');
        if (!client) throw notFound('Sourcing client');
        if (!client.revokedAt) await tx.update(sourcingClients).set({ revokedAt: now }).where(eq(sourcingClients.id, clientId));
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
        .returning({ id: sourcingClients.id, name: sourcingClients.name });
    return row ?? null;
}

export type SourcingClientView = { clientId: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

/** Admin listing. Never includes the token or its hash. */
export async function listSourcingClients(): Promise<SourcingClientView[]> {
    const rows = await getDb()
        .select({ id: sourcingClients.id, name: sourcingClients.name, createdAt: sourcingClients.createdAt, lastUsedAt: sourcingClients.lastUsedAt, revokedAt: sourcingClients.revokedAt })
        .from(sourcingClients)
        .orderBy(desc(sourcingClients.createdAt));
    return rows.map((r) => ({
        clientId: r.id,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
    }));
}
