/**
 * Q&A and polls on a live show.
 *
 *   Ask Creator  -> queued (`question.created`); the host answers with the `answer_question`
 *                   intent (`question.answered`, answeredBy host).
 *   Ask Make AI  -> `question.created`, then answered at once from the featured build's record
 *                   (`question.answered`, answeredBy make_ai). See make-ai-answer.ts.
 *   Polls        -> `create_poll` intent (`poll.created`), one vote per signed-in viewer,
 *                   live counts via `poll.result`.
 */
import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { PollView, QuestionView } from '../../contracts/live';
import { getDb, withTx } from '../db';
import { livePolls, livePollVotes, liveQuestions } from '../db/schema';
import { ApiError } from '../http';
import { actorFor, publicName, requireSignedIn, type ShowAccess } from './access';
import { assertNotMuted, assertShowOpenForTalk } from './chat';
import { appendLiveEvent, MAKE_AI_LIVE_ACTOR, type LiveActor } from './events';
import { loadBuildFacts } from './featured';
import { answerLiveQuestion, type AnswerOptions } from './make-ai-answer';
import { moderateText } from './moderation';

type QuestionRow = typeof liveQuestions.$inferSelect;

export function toQuestionView(r: QuestionRow): QuestionView {
    return {
        id: r.id,
        mode: r.mode,
        text: r.text,
        askedBy: r.askedByName,
        answer: r.answer,
        answeredBy: r.answeredBy,
        createdAt: r.createdAt.toISOString(),
    };
}

export async function listQuestions(showId: string, limit = 50): Promise<QuestionView[]> {
    const rows = await getDb().select().from(liveQuestions).where(eq(liveQuestions.showId, showId)).orderBy(desc(liveQuestions.createdAt)).limit(limit);
    return rows.map(toQuestionView);
}

export async function askQuestion(access: ShowAccess, input: { mode: 'creator' | 'make_ai'; text: string }, opts: AnswerOptions = {}): Promise<QuestionView> {
    requireSignedIn(access);
    assertShowOpenForTalk(access);
    const moderated = moderateText(input.text);
    if (!moderated.ok) throw new ApiError('VALIDATION_FAILED', moderated.message, 400, { reason: moderated.reason });
    await assertNotMuted(access);
    const { show } = access;
    const actor = actorFor(access);
    const [q] = await getDb()
        .insert(liveQuestions)
        .values({ showId: show.id, mode: input.mode, text: moderated.text, askedByUserId: access.viewer.user.id, askedByName: publicName(access.viewer), buildId: show.featuredBuildId })
        .returning();
    await appendLiveEvent(show.id, { event: 'question.created', actor, buildId: show.featuredBuildId, payload: { questionId: q.id, mode: q.mode, text: q.text, askedBy: q.askedByName } });
    if (input.mode !== 'make_ai') return toQuestionView(q);

    const facts = show.featuredBuildId ? await loadBuildFacts(show.featuredBuildId) : null;
    const grounded = await answerLiveQuestion(q.text, facts, opts);
    const [answered] = await getDb()
        .update(liveQuestions)
        .set({ answer: grounded.answer, answeredBy: 'make_ai', answeredAt: new Date() })
        .where(eq(liveQuestions.id, q.id))
        .returning();
    await appendLiveEvent(show.id, {
        event: 'question.answered',
        actor: MAKE_AI_LIVE_ACTOR,
        buildId: show.featuredBuildId,
        payload: { questionId: q.id, mode: 'make_ai', text: q.text, answer: grounded.answer, answeredBy: 'make_ai', source: grounded.source, offline: grounded.offline },
    });
    return toQuestionView(answered);
}

export async function answerQuestion(access: ShowAccess, questionId: string, answer: string, actor: LiveActor) {
    const moderated = moderateText(answer);
    if (!moderated.ok && moderated.reason !== 'link') throw new ApiError('VALIDATION_FAILED', moderated.message, 400, { reason: moderated.reason });
    const text = answer.replace(/\s+/g, ' ').trim();
    const [q] = await getDb()
        .select()
        .from(liveQuestions)
        .where(and(eq(liveQuestions.id, questionId), eq(liveQuestions.showId, access.show.id)))
        .limit(1);
    if (!q) throw new ApiError('NOT_FOUND', 'Question not found');
    const [updated] = await getDb().update(liveQuestions).set({ answer: text, answeredBy: 'host', answeredAt: new Date() }).where(eq(liveQuestions.id, q.id)).returning();
    return appendLiveEvent(access.show.id, {
        event: 'question.answered',
        actor,
        buildId: q.buildId,
        payload: { questionId: q.id, mode: q.mode, text: q.text, answer: updated.answer, answeredBy: 'host' },
    });
}

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

type PollRow = typeof livePolls.$inferSelect;

async function pollView(row: PollRow, viewerId: string | null): Promise<PollView> {
    const db = getDb();
    const counts = await db.select({ optionIndex: livePollVotes.optionIndex, n: count() }).from(livePollVotes).where(eq(livePollVotes.pollId, row.id)).groupBy(livePollVotes.optionIndex);
    const by = new Map(counts.map((c) => [c.optionIndex, Number(c.n)]));
    const options = row.options.map((label, i) => ({ label, votes: by.get(i) ?? 0 }));
    let viewerVote: number | null = null;
    if (viewerId) {
        const [v] = await db
            .select({ optionIndex: livePollVotes.optionIndex })
            .from(livePollVotes)
            .where(and(eq(livePollVotes.pollId, row.id), eq(livePollVotes.userId, viewerId)))
            .limit(1);
        viewerVote = v?.optionIndex ?? null;
    }
    return { id: row.id, question: row.question, options, total: options.reduce((s, o) => s + o.votes, 0), status: row.status, viewerVote, createdAt: row.createdAt.toISOString() };
}

/** The latest poll of the show (open or most recently closed), or null. */
export async function currentPoll(showId: string, viewerId: string | null): Promise<PollView | null> {
    const [row] = await getDb().select().from(livePolls).where(eq(livePolls.showId, showId)).orderBy(desc(livePolls.createdAt)).limit(1);
    return row ? pollView(row, viewerId) : null;
}

export async function createPoll(access: ShowAccess, input: { question: string; options: string[] }, actor: LiveActor) {
    return withTx(async (tx) => {
        const now = new Date();
        await tx
            .update(livePolls)
            .set({ status: 'CLOSED', closedAt: now })
            .where(and(eq(livePolls.showId, access.show.id), eq(livePolls.status, 'OPEN')));
        const [poll] = await tx.insert(livePolls).values({ showId: access.show.id, question: input.question, options: input.options, createdBy: actor.id }).returning();
        return appendLiveEvent(access.show.id, { event: 'poll.created', actor, payload: { pollId: poll.id, question: poll.question, options: poll.options } }, tx);
    });
}

export async function votePoll(access: ShowAccess, pollId: string, optionIndex: number): Promise<PollView> {
    requireSignedIn(access);
    const db = getDb();
    const [poll] = await db
        .select()
        .from(livePolls)
        .where(and(eq(livePolls.id, pollId), eq(livePolls.showId, access.show.id)))
        .limit(1);
    if (!poll) throw new ApiError('NOT_FOUND', 'Poll not found');
    if (poll.status !== 'OPEN') throw new ApiError('CONFLICT', 'This poll is closed.');
    if (optionIndex >= poll.options.length) throw new ApiError('VALIDATION_FAILED', 'Pick one of the poll options.');
    const inserted = await db.insert(livePollVotes).values({ pollId, userId: access.viewer.user.id, optionIndex }).onConflictDoNothing().returning();
    const view = await pollView(poll, access.viewer.user.id);
    if (inserted.length) {
        await appendLiveEvent(access.show.id, {
            event: 'poll.result',
            actor: { kind: 'system', id: 'discovermake', name: null },
            payload: { pollId, counts: view.options.map((o) => o.votes), total: view.total },
        });
    }
    return view;
}

/** Oldest-first questions for the control room queue. */
export async function listQuestionsForHost(showId: string): Promise<QuestionView[]> {
    const rows = await getDb().select().from(liveQuestions).where(eq(liveQuestions.showId, showId)).orderBy(asc(liveQuestions.createdAt)).limit(200);
    return rows.map(toQuestionView);
}
