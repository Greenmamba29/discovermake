/**
 * Chat and question moderation (workflow 06 "Moderation, trust and safety").
 *
 * - Keyword filter: a small blocklist matched on a normalized form of the text
 *   (lowercase, common look-alike digits and symbols folded, separators removed between
 *   letters), so "f.u.c.k" or "sh1t" are caught too.
 * - Link blocking: no URLs or bare domains in chat (spam, phishing, off-platform payment).
 * - Slow mode and mutes are time checks, kept pure here so they are easy to test.
 *
 * Pure functions only; the routes apply them before anything is persisted.
 */

/** Deliberately small; extend from ops reports. Matched as whole words on the normalized text. */
export const BLOCKED_TERMS: readonly string[] = [
    'fuck',
    'fucking',
    'shit',
    'cunt',
    'bitch',
    'asshole',
    'whore',
    'slut',
    'retard',
    'faggot',
    'nigger',
    'kys',
    'killyourself',
];

const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

export function normalizeForFilter(text: string): string {
    const lowered = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const folded = lowered.replace(/[013457@$!]/g, (c) => LOOKALIKES[c] ?? c);
    // Collapse "f.u.c.k" / "f u c k" style spacing between single letters.
    return folded.replace(/\b([a-z])[\s._*-]+(?=[a-z]\b)/g, '$1');
}

const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|co|ly|gg|xyz|me|app|shop|store|link|site|info|biz|live|tv|to|us|uk)\b|\b(bit\.ly|t\.me|wa\.me)\b)/i;

export type ModerationReason = 'blocked_term' | 'link' | 'empty';
export type ModerationResult = { ok: true; text: string } | { ok: false; reason: ModerationReason; message: string };

export function containsLink(text: string): boolean {
    return LINK_RE.test(text);
}

export function containsBlockedTerm(text: string): boolean {
    const normalized = normalizeForFilter(text);
    const words = normalized.split(/[^a-z]+/).filter(Boolean);
    const joined = words.join('');
    return words.some((w) => BLOCKED_TERMS.includes(w)) || BLOCKED_TERMS.some((t) => t.length >= 8 && joined.includes(t));
}

/** Check a chat line or a question. Returns the trimmed text when allowed. */
export function moderateText(raw: string): ModerationResult {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return { ok: false, reason: 'empty', message: 'Write a message first.' };
    if (containsLink(text)) return { ok: false, reason: 'link', message: 'Links are not allowed in live chat.' };
    if (containsBlockedTerm(text)) return { ok: false, reason: 'blocked_term', message: 'That message breaks the community guidelines.' };
    return { ok: true, text };
}

export type SlowModeDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Slow mode: one message per `slowModeSeconds` per viewer (hosts are exempt; the caller decides). */
export function checkSlowMode(lastMessageAt: Date | null, slowModeSeconds: number, now: Date = new Date()): SlowModeDecision {
    if (slowModeSeconds <= 0 || !lastMessageAt) return { ok: true };
    const elapsed = (now.getTime() - lastMessageAt.getTime()) / 1000;
    if (elapsed >= slowModeSeconds) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(slowModeSeconds - elapsed)) };
}

export function isMuted(mutedUntil: Date | null | undefined, now: Date = new Date()): boolean {
    return !!mutedUntil && mutedUntil.getTime() > now.getTime();
}
