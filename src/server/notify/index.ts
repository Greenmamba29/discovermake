/**
 * Transactional notifications (email). Console adapter by default; Resend via
 * fetch when RESEND_API_KEY is set. Never throws into the caller's business
 * flow: failures are logged (notifications are side effects after commit).
 *
 * OWNER: orders agent. Signatures FINAL.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { renderEmail } from './templates';

export type NotifyPayloads = {
    /** Buyer: payment confirmed. Includes the signed order link (only place besides checkout it appears). */
    'order.confirmed': { to: string; orderId: string; orderNumber: string; orderUrl: string; totalCents: number; currency: string };
    'order.payment_failed': { to: string; orderId: string; orderNumber: string; reason: string | null };
    /** Shop: new job offer. */
    'shop.job_offered': { to: string; shopName: string; jobId: string; orderNumber: string; offerExpiresAt: string; consoleUrl: string };
    'order.in_production': { to: string; orderId: string; orderNumber: string; shopName: string };
    'order.shipped': { to: string; orderId: string; orderNumber: string; carrier: string; trackingNumber: string; trackingUrl: string | null };
    'order.delivered': { to: string; orderId: string; orderNumber: string; passportUrl: string | null };
    /** Ops: something needs a human (amount mismatch, no shop accepted, QA failed twice, carrier exception). */
    'ops.alert': { subject: string; message: string; orderId?: string };
    /** R2 accounts: 6-digit sign-in code (a credential: never logged in full). */
    'auth.sign_in_code': { to: string; code: string; challengeId: string; expiresMinutes: number };
};

export type NotifyKind = keyof NotifyPayloads;

export type NotifyResult = { delivered: boolean; adapter: 'console' | 'resend'; id: string | null };

export const RESEND_API_URL = 'https://api.resend.com/emails';

/** Kinds whose body contains a bearer credential (the order link). Never logged in full. */
const SENSITIVE_KINDS: ReadonlySet<NotifyKind> = new Set(['order.confirmed', 'auth.sign_in_code']);

function recipientFor<K extends NotifyKind>(kind: K, payload: NotifyPayloads[K]): string | null {
    if (kind === 'ops.alert') return env().OPS_EMAIL ?? null;
    return (payload as { to?: string }).to ?? null;
}

function redact(text: string): string {
    // Order-link tokens look like `t=dmo_<base64url>`; never print them to logs.
    return text.replace(/([?&]t=)[^&\s"]+/g, '$1[redacted]').replace(/\b\d{6}\b/g, '[code]');
}

/** Send a notification of `kind`. Resolves (never rejects). */
export async function notify<K extends NotifyKind>(kind: K, payload: NotifyPayloads[K]): Promise<NotifyResult> {
    let apiKey: string | undefined;
    try {
        apiKey = env().RESEND_API_KEY;
    } catch (err) {
        console.error('[notify] env error', err);
    }
    try {
        const email = renderEmail(kind, payload);
        const to = recipientFor(kind, payload);

        if (!apiKey || !to) {
            const id = `console_${randomUUID()}`;
            const body = SENSITIVE_KINDS.has(kind) ? redact(email.text) : email.text;
            console.info(`[notify:console] ${kind} -> ${to ?? '(no recipient)'} · ${email.subject}\n${body}`);
            // Delivered only in the sense of "handed to the configured adapter"; console is the dev adapter.
            return { delivered: !!to, adapter: 'console', id };
        }

        const res = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
                // Resend dedupes retries with the same key for 24 h.
                'idempotency-key': `${kind}:${idempotencyKeyFor(kind, payload)}`,
            },
            body: JSON.stringify({ from: env().EMAIL_FROM, to: [to], subject: email.subject, text: email.text, html: email.html }),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            console.error(`[notify:resend] ${kind} failed with HTTP ${res.status}: ${detail.slice(0, 500)}`);
            return { delivered: false, adapter: 'resend', id: null };
        }
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        return { delivered: true, adapter: 'resend', id: data.id ?? null };
    } catch (err) {
        console.error(`[notify] ${kind} failed`, err);
        return { delivered: false, adapter: apiKey ? 'resend' : 'console', id: null };
    }
}

function idempotencyKeyFor<K extends NotifyKind>(kind: K, payload: NotifyPayloads[K]): string {
    const p = payload as Record<string, unknown>;
    if (kind === 'shop.job_offered') return String(p.jobId);
    if (kind === 'auth.sign_in_code') return String(p.challengeId);
    if (kind === 'ops.alert') return `${String(p.orderId ?? 'none')}:${String(p.subject)}:${Math.floor(Date.now() / 60_000)}`;
    return String(p.orderId ?? randomUUID());
}
