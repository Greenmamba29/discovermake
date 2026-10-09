/**
 * Client state of a live show, built from a ShowSnapshot and then ONLY from Live Build
 * Protocol events (workflow 06 rule 1: the product card is an overlay driven by events).
 *
 * Pure and idempotent: re-applying an event with a seq at or below `lastSeq` is a no-op,
 * and every count is set from the event's absolute value, so a snapshot followed by an
 * overlapping stream never double-counts. Replays fold the log up to the player position.
 */
import { DropView, FeaturedProduct, LiveEvent, type PollView, type QuestionView, type ShowSnapshot, type ShowView } from '@/contracts/live';

export type LiveState = {
    show: ShowView;
    featured: FeaturedProduct | null;
    drop: DropView | null;
    dropEnding: boolean;
    questions: QuestionView[];
    chat: LiveEvent[];
    removed: number[];
    poll: PollView | null;
    milestones: LiveEvent[];
    lastSeq: number;
    slowModeSeconds: number;
};

const MAX_CHAT = 120;

export function stateFromSnapshot(s: ShowSnapshot): LiveState {
    return {
        show: s.show,
        featured: s.featured,
        drop: s.drop,
        dropEnding: false,
        questions: s.questions,
        chat: s.recentChat,
        removed: [],
        poll: s.poll,
        milestones: [],
        lastSeq: s.lastSeq,
        slowModeSeconds: s.slowModeSeconds,
    };
}

/** Empty state for replays: the show, before its first event. */
export function replayBase(s: ShowSnapshot): LiveState {
    return { ...stateFromSnapshot(s), featured: null, drop: null, questions: [], chat: [], poll: null, lastSeq: 0, show: { ...s.show, likeCount: 0, viewerCount: 0 } };
}

/** Accept only well-formed events; server-signed types without `sig` are rejected by the contract. */
export function parseLiveEvent(raw: unknown): LiveEvent | null {
    const r = LiveEvent.safeParse(raw);
    return r.success ? (r.data as LiveEvent) : null;
}

function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function applyEvent(state: LiveState, e: LiveEvent): LiveState {
    if (e.seq <= state.lastSeq) return state;
    const s: LiveState = { ...state, lastSeq: e.seq };
    const p = e.payload as Record<string, unknown>;
    switch (e.event) {
        case 'product.focus': {
            const f = FeaturedProduct.safeParse(p);
            if (f.success) s.featured = f.data;
            return s;
        }
        case 'show.started':
            s.show = { ...s.show, status: 'LIVE', startedAt: typeof p.startedAt === 'string' ? p.startedAt : e.at };
            return s;
        case 'show.ended':
            s.show = { ...s.show, status: 'ENDED', endedAt: typeof p.endedAt === 'string' ? p.endedAt : e.at };
            return s;
        case 'drop.started': {
            const d = DropView.safeParse(p.drop);
            if (d.success) {
                s.drop = { ...d.data, viewerClaimedSlots: state.drop?.id === d.data.id ? state.drop.viewerClaimedSlots : 0 };
                s.dropEnding = false;
            }
            return s;
        }
        case 'build_slot.claimed':
        case 'inventory.change': {
            const claimed = num(p.claimedSlots);
            if (s.drop && p.dropId === s.drop.id && claimed !== null) s.drop = { ...s.drop, claimedSlots: claimed };
            return s;
        }
        case 'drop.ending':
            if (s.drop && p.dropId === s.drop.id) s.dropEnding = true;
            return s;
        case 'drop.closed': {
            const status = p.status === 'CONFIRMED' || p.status === 'FAILED' ? p.status : 'CLOSED';
            const claimed = num(p.claimedSlots);
            if (s.drop && p.dropId === s.drop.id) s.drop = { ...s.drop, status, claimedSlots: claimed ?? s.drop.claimedSlots };
            s.dropEnding = false;
            return s;
        }
        case 'question.created': {
            const id = String(p.questionId ?? '');
            if (!id || s.questions.some((q) => q.id === id)) return s;
            s.questions = [...s.questions, { id, mode: p.mode === 'make_ai' ? 'make_ai' : 'creator', text: String(p.text ?? ''), askedBy: String(p.askedBy ?? e.actor.name ?? 'Viewer'), answer: null, answeredBy: null, createdAt: e.at }];
            return s;
        }
        case 'question.answered': {
            const id = String(p.questionId ?? '');
            const answeredBy = p.answeredBy === 'make_ai' ? 'make_ai' : 'host';
            const existing = s.questions.find((q) => q.id === id);
            s.questions = existing
                ? s.questions.map((q) => (q.id === id ? { ...q, answer: String(p.answer ?? ''), answeredBy } : q))
                : [...s.questions, { id, mode: p.mode === 'make_ai' ? 'make_ai' : 'creator', text: String(p.text ?? ''), askedBy: 'Viewer', answer: String(p.answer ?? ''), answeredBy, createdAt: e.at }];
            return s;
        }
        case 'poll.created': {
            const options = Array.isArray(p.options) ? p.options.map(String) : [];
            s.poll = { id: String(p.pollId), question: String(p.question ?? ''), options: options.map((label) => ({ label, votes: 0 })), total: 0, status: 'OPEN', viewerVote: null, createdAt: e.at };
            return s;
        }
        case 'poll.result': {
            if (!s.poll || s.poll.id !== p.pollId || !Array.isArray(p.counts)) return s;
            const counts = p.counts.map((c) => Number(c) || 0);
            s.poll = { ...s.poll, options: s.poll.options.map((o, i) => ({ ...o, votes: counts[i] ?? o.votes })), total: num(p.total) ?? counts.reduce((a, b) => a + b, 0) };
            return s;
        }
        case 'chat.message':
            if (s.chat.some((c) => c.seq === e.seq)) return s;
            s.chat = [...s.chat, e].slice(-MAX_CHAT);
            if (typeof p.slowModeSeconds === 'number') s.slowModeSeconds = p.slowModeSeconds;
            return s;
        case 'chat.removed': {
            const seq = num(p.eventSeq);
            if (seq !== null) s.removed = [...s.removed, seq];
            return s;
        }
        case 'reaction.like': {
            const n = num(p.likeCount);
            if (n !== null) s.show = { ...s.show, likeCount: n };
            return s;
        }
        case 'viewer.count': {
            const n = num(p.viewerCount);
            if (n !== null) s.show = { ...s.show, viewerCount: n };
            return s;
        }
        case 'machine.started':
        case 'machine.completed':
        case 'inspection.passed':
        case 'prototype.completed':
            s.milestones = [...s.milestones, e].slice(-6);
            return s;
        default:
            return s;
    }
}

/** Fold a replay log up to `positionMs` of the broadcast. */
export function replayAt(base: LiveState, events: LiveEvent[], positionMs: number): LiveState {
    let s = base;
    for (const e of events) {
        if (e.streamTsMs > positionMs) break;
        s = applyEvent(s, e);
    }
    return s;
}

export function visibleChat(state: LiveState): LiveEvent[] {
    const removed = new Set(state.removed);
    return state.chat.filter((c) => !removed.has(c.seq));
}
