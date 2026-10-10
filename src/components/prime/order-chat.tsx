'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ImagePlus, MessageCircle, PauseCircle, Send, ShieldCheck } from 'lucide-react';
import { MAX_MESSAGE_CHARS, type OrderChatView, type PostMessageRequest, type QuickReply } from '@/contracts/prime';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export const CHAT_POLL_MS = 4_000;

/** Render plain text with http(s) links made clickable safely (no HTML is ever injected). */
export function linkify(text: string): ReactNode[] {
    const out: ReactNode[] = [];
    const re = /\bhttps?:\/\/[^\s<>"']+/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text))) {
        const raw = m[0].replace(/[.,!?;:)]+$/, '');
        if (m.index > last) out.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
        let safe: string | null = null;
        try {
            const u = new URL(raw);
            safe = u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
        } catch {
            safe = null;
        }
        out.push(
            safe ? (
                <a key={i++} href={safe} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all underline">
                    {raw}
                </a>
            ) : (
                <Fragment key={i++}>{raw}</Fragment>
            ),
        );
        last = m.index + raw.length;
        re.lastIndex = last;
    }
    if (last < text.length) out.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
    return out;
}

export type ChatAdapter = {
    key: readonly unknown[];
    load: () => Promise<OrderChatView>;
    post: (body: PostMessageRequest) => Promise<OrderChatView>;
    upload?: (file: File) => Promise<string>;
};

/**
 * Order chat (Glovo "Help with an order" + LinkedIn quick-reply chips above the composer).
 * Polls every few seconds; quick replies are contextual to the order status.
 */
export function OrderChat({ adapter, title = 'Messages', intro }: { adapter: ChatAdapter; title?: string; intro?: string }) {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: adapter.key, queryFn: adapter.load, refetchInterval: CHAT_POLL_MS, refetchIntervalInBackground: false, retry: false });
    const [text, setText] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const chat = q.data;

    const send = async (body: PostMessageRequest, key: string) => {
        setBusy(key);
        setError(null);
        try {
            const next = await adapter.post(body);
            qc.setQueryData(adapter.key, next);
            if (key === 'text') setText('');
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(null);
        }
    };
    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (text.trim()) void send({ body: text.trim() }, 'text');
    };
    const onQuick = (key: QuickReply) => {
        if (key === 'send_photo' && chat?.viewer === 'shop') {
            fileRef.current?.click();
            return;
        }
        void send({ quickReply: key }, key);
    };
    const onFile = async (file: File | undefined) => {
        if (!file || !adapter.upload) return;
        setBusy('photo');
        setError(null);
        try {
            const key = await adapter.upload(file);
            const next = await adapter.post({ attachmentKey: key, ...(chat?.viewer === 'shop' ? { quickReply: 'send_photo' as const } : {}) });
            qc.setQueryData(adapter.key, next);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(null);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    return (
        <section aria-labelledby="chat-heading" className="rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" data-testid="order-chat">
            <div className="flex items-center justify-between gap-2 border-b border-graphite-700 px-4 py-3 sm:px-5">
                <h2 id="chat-heading" className="flex items-center gap-2 font-display text-lg font-bold">
                    <MessageCircle className="h-5 w-5 text-signal" aria-hidden /> {title}
                </h2>
                {chat && chat.unreadCount > 0 && (
                    <span className="rounded-full bg-signal px-2 py-0.5 font-mono text-xs font-bold text-signal-ink" data-testid="chat-unread">
                        {chat.unreadCount} new
                    </span>
                )}
            </div>
            <p className="flex items-center gap-1.5 px-4 pt-3 text-xs text-fg-subtle sm:px-5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden /> {intro ?? 'Keep payments and files in DiscoverMake. We never ask you to pay off-platform.'}
            </p>
            {chat?.hold && (
                <p className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-fg ring-1 ring-inset ring-amber/30 sm:mx-5" data-testid="chat-hold">
                    <PauseCircle className="h-4 w-4 text-amber" aria-hidden />
                    {chat.hold.status === 'requested' ? 'Hold requested · waiting for our team to confirm with the shop' : chat.hold.status === 'acknowledged' ? 'Hold confirmed · production is paused' : 'Hold declined'}
                </p>
            )}
            <ol className="max-h-[26rem] space-y-3 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite" data-testid="chat-messages" tabIndex={0} aria-label="Conversation">
                {q.isLoading && <li className="text-sm text-fg-subtle">Loading messages…</li>}
                {chat && chat.messages.length === 0 && <li className="text-sm text-fg-subtle">No messages yet. Ask anything about this order.</li>}
                {chat?.messages.map((m) => (
                    <li key={m.id} className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')} data-testid={`chat-message-${m.authorKind}`}>
                        <span className="mb-0.5 text-[11px] text-fg-subtle">
                            {m.authorLabel} · {dateTime(m.createdAt)}
                        </span>
                        <span
                            className={cn(
                                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                                m.mine ? 'bg-signal text-signal-ink' : m.authorKind === 'system' ? 'bg-graphite-800 text-fg-muted ring-1 ring-graphite-700' : 'bg-graphite-750 text-fg',
                            )}
                        >
                            {linkify(m.body)}
                            {m.attachmentUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={m.attachmentUrl} alt="Photo attached to the message" className="mt-2 max-h-48 rounded-lg" />
                            )}
                        </span>
                    </li>
                ))}
            </ol>
            <div className="border-t border-graphite-700 px-4 py-3 sm:px-5">
                {chat && chat.quickReplies.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Quick replies" data-testid="quick-replies">
                        {chat.quickReplies.map((r) => (
                            <button
                                key={r.key}
                                type="button"
                                onClick={() => onQuick(r.key)}
                                disabled={busy !== null}
                                className="inline-flex h-9 items-center rounded-full bg-graphite-800 px-3 text-sm font-semibold text-fg ring-1 ring-inset ring-graphite-600 hover:bg-graphite-750 disabled:opacity-60"
                                data-testid={`quick-reply-${r.key}`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                )}
                <form onSubmit={onSubmit} className="flex items-end gap-2">
                    {adapter.upload && (
                        <>
                            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="chat-photo-input" />
                            <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} loading={busy === 'photo'} aria-label="Attach a photo">
                                <ImagePlus className="h-4 w-4" aria-hidden />
                            </Button>
                        </>
                    )}
                    <label className="sr-only" htmlFor="chat-input">
                        Message
                    </label>
                    <textarea
                        id="chat-input"
                        rows={1}
                        maxLength={MAX_MESSAGE_CHARS}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Write a message"
                        className="min-h-[40px] flex-1 resize-none rounded-xl bg-graphite-850 px-3 py-2 text-sm text-fg ring-1 ring-inset ring-graphite-600 placeholder:text-fg-subtle focus:outline-none focus:ring-signal"
                        data-testid="chat-input"
                    />
                    <Button type="submit" size="sm" disabled={!text.trim() || busy !== null} loading={busy === 'text'} aria-label="Send message" data-testid="chat-send">
                        <Send className="h-4 w-4" aria-hidden />
                    </Button>
                </form>
                {error && (
                    <p className="mt-2 text-xs font-medium text-ember" role="alert">
                        {error}
                    </p>
                )}
            </div>
        </section>
    );
}
