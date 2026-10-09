/**
 * R3 transactional emails (Prime trial reminder, new chat message, invoice issued).
 * Same adapters as src/server/notify: console by default, Resend when RESEND_API_KEY is
 * set. Never throws into the caller (emails are side effects after commit).
 */
import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { RESEND_API_URL } from '../notify';
import { escapeHtml } from '../notify/templates';

export type R3Mail = {
    to: string;
    subject: string;
    paragraphs: string[];
    link?: { label: string; href: string };
    /** Resend idempotency key (dedupes retries for 24 h). */
    idempotencyKey: string;
    /** The link carries a bearer token (order link): never log it in full. */
    sensitive?: boolean;
};

export type R3MailResult = { delivered: boolean; adapter: 'console' | 'resend' };

function render(m: R3Mail) {
    const text = [...m.paragraphs, ...(m.link ? [`${m.link.label}: ${m.link.href}`] : []), '', 'DiscoverMake · Discover. Make. Build.'].join('\n\n');
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(m.subject)}</h1>${m.paragraphs
        .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`)
        .join('')}${
        m.link
            ? `<p style="margin:0 0 16px"><a href="${escapeHtml(m.link.href)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(m.link.label)}</a></p>`
            : ''
    }<p style="margin:32px 0 0;color:#666;font-size:12px">DiscoverMake · Discover. Make. Build.</p></body></html>`;
    return { text, html };
}

export async function sendR3Mail(m: R3Mail): Promise<R3MailResult> {
    let apiKey: string | undefined;
    try {
        apiKey = env().RESEND_API_KEY;
        const { text, html } = render(m);
        if (!apiKey) {
            const body = m.sensitive ? text.replace(/([?&]t=)[^&\s"]+/g, '$1[redacted]') : text;
            console.info(`[notify:console] r3 -> ${m.to} · ${m.subject}\n${body}`);
            return { delivered: true, adapter: 'console' };
        }
        const res = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotencyKey || randomUUID() },
            body: JSON.stringify({ from: env().EMAIL_FROM, to: [m.to], subject: m.subject, text, html }),
        });
        if (!res.ok) {
            console.error(`[notify:resend] r3 mail failed with HTTP ${res.status}`);
            return { delivered: false, adapter: 'resend' };
        }
        return { delivered: true, adapter: 'resend' };
    } catch (err) {
        console.error('[notify] r3 mail failed', err);
        return { delivered: false, adapter: apiKey ? 'resend' : 'console' };
    }
}
