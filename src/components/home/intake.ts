import { MAKE_AI_MAX_INPUT_CHARS } from '@/contracts/make-ai';

/**
 * Home intake routing (Uber "Where to?" → "What do you want to make?"):
 * typed text goes to Make AI prefilled; a DXF goes to the instant-quote upload pipeline.
 */
export type IntakeRoute = { kind: 'make-ai'; href: string } | { kind: 'upload'; file: File } | { kind: 'empty' } | { kind: 'make-ai-disabled' };

export function makeAiPromptHref(text: string): string {
    return `/make/ai?prompt=${encodeURIComponent(text.trim().slice(0, MAKE_AI_MAX_INPUT_CHARS))}`;
}

/** Decide where an intake submission goes. A file always wins over text. */
export function routeIntake(input: { text: string; file?: File | null; makeAiEnabled: boolean }): IntakeRoute {
    if (input.file) return { kind: 'upload', file: input.file };
    const text = input.text.trim();
    if (!text) return { kind: 'empty' };
    if (!input.makeAiEnabled) return { kind: 'make-ai-disabled' };
    return { kind: 'make-ai', href: makeAiPromptHref(text) };
}
