/**
 * Audit log of MCP tool calls (`sourcing_tool_calls`). Arguments are never stored:
 * only the sha256 of their canonical JSON, so a call can be matched against a
 * recorded agent session without keeping supplier data or base64 documents.
 */
import { canonicalJson, sha256Hex } from '../auth/tokens';
import { getDb } from '../db';
import { sourcingToolCalls } from '../db/schema';

export function argsSha256(args: unknown): string {
    return sha256Hex(canonicalJson(args ?? {}));
}

export type ToolCallRecord = {
    clientId: string;
    tool: string;
    jobId: string | null;
    ok: boolean;
    errorCode: string | null;
    argsSha256: string;
    durationMs: number;
};

/** Best effort: an audit write failure is logged, never surfaced to the agent. */
export async function recordToolCall(rec: ToolCallRecord): Promise<void> {
    try {
        await getDb()
            .insert(sourcingToolCalls)
            .values({ ...rec, tool: rec.tool.slice(0, 120), durationMs: Math.max(0, Math.round(rec.durationMs)) });
    } catch (err) {
        console.error('[sourcing] failed to record tool call', err);
    }
}
