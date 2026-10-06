/**
 * Make AI intake (spec §7.5 "Canonical Creation Intent object", workflow 01 seed).
 *
 *   POST /api/make-ai/intake   MakeAiIntakeRequest -> MakeAiIntakeResponse   (public, flag-gated)
 *
 * Behind `MAKE_AI_ENABLED=true` (404 otherwise); 503 when GOOGLE_GENERATIVE_AI_API_KEY is unset.
 * The response is an AI estimate of what the buyer wants to make. It is NOT a quote:
 * binding prices only come from the DXF quote engine.
 *
 * `CreationIntent` doubles as the structured-output schema handed to the model, so
 * every bound here is also enforced on the model's answer before it reaches the UI.
 */
import { z } from 'zod';

/** Hard cap on the buyer's description, enforced server-side (the UI mirrors it). */
export const MAKE_AI_MAX_INPUT_CHARS = 2000;

export const CREATION_INTENT_KINDS = ['create', 'modify', 'reconstruct', 'manufacture'] as const;
export const CreationIntentKind = z.enum(CREATION_INTENT_KINDS);
export type CreationIntentKind = z.infer<typeof CreationIntentKind>;

/**
 * standard  = fits the DiscoverMake network as described.
 * elevated  = makeable but needs a specialist review (load-bearing, food contact, outdoor electrical, ...).
 * regulated = out of scope for self-serve (weapons and weapon parts, medical devices, pressure vessels,
 *             child-safety products, ...). Comes with a `refusal_note`.
 */
export const MAKE_AI_RISK_CLASSES = ['standard', 'elevated', 'regulated'] as const;
export const MakeAiRiskClass = z.enum(MAKE_AI_RISK_CLASSES);
export type MakeAiRiskClass = z.infer<typeof MakeAiRiskClass>;

export const REQUIREMENT_CATEGORIES = ['function', 'dimension', 'material', 'environment', 'finish', 'quantity', 'budget', 'timeline', 'compliance', 'other'] as const;
export const RequirementCategory = z.enum(REQUIREMENT_CATEGORIES);
export type RequirementCategory = z.infer<typeof RequirementCategory>;

/** user = stated in the description; inferred = reasoned from it. Dimensions must always be `user`. */
export const REQUIREMENT_SOURCES = ['user', 'inferred'] as const;
export const RequirementSource = z.enum(REQUIREMENT_SOURCES);
export type RequirementSource = z.infer<typeof RequirementSource>;

const line = (max: number) => z.string().trim().min(1).max(max);

export const IntentRequirement = z.object({
    /** Short stable id within this intent, e.g. "R1". */
    id: z.string().trim().min(1).max(16),
    text: line(300),
    category: RequirementCategory,
    source: RequirementSource,
    /** 0..1: how sure Make AI is that this is really required. */
    confidence: z.number().min(0).max(1),
});
export type IntentRequirement = z.infer<typeof IntentRequirement>;

export const IntentUnknown = z.object({
    question: line(300),
    why_it_matters: line(300),
    /** A sensible default the buyer can accept. Never an invented dimension. Empty = none. */
    suggested_default: z.string().trim().max(200).optional(),
});
export type IntentUnknown = z.infer<typeof IntentUnknown>;

export const MaterialSuggestion = z.object({
    material: line(120),
    why: line(300),
});
export type MaterialSuggestion = z.infer<typeof MaterialSuggestion>;

export const CreationIntent = z.object({
    intent: CreationIntentKind,
    product_type: line(120),
    /** One or two sentences restating what will be made. */
    summary: line(600),
    requirements: z.array(IntentRequirement).max(20),
    constraints: z.array(line(300)).max(12),
    unknowns: z.array(IntentUnknown).max(12),
    materials_suggested: z.array(MaterialSuggestion).max(6),
    processes_suggested: z.array(line(120)).max(6),
    risk_class: MakeAiRiskClass,
    required_specialists: z.array(line(80)).max(6),
    /** Set when the request is out of scope (regulated items, weapons, ...): why DiscoverMake will not make it. Empty = none. */
    refusal_note: z.string().trim().max(400).optional(),
});
export type CreationIntent = z.infer<typeof CreationIntent>;

export const MakeAiIntakeRequest = z.object({
    text: z
        .string()
        .trim()
        .min(3, 'Describe what you want to make.')
        .max(MAKE_AI_MAX_INPUT_CHARS, `Keep the description under ${MAKE_AI_MAX_INPUT_CHARS} characters.`),
});
export type MakeAiIntakeRequest = z.infer<typeof MakeAiIntakeRequest>;

export const MakeAiIntakeResponse = z.object({
    intentId: z.string().uuid(),
    intent: CreationIntent,
    /** Model id that produced the estimate (transparency; e.g. "gemini-3.5-flash"). */
    model: z.string(),
    /** Always true: this is an AI estimate, not a binding quote. */
    estimateOnly: z.literal(true),
});
export type MakeAiIntakeResponse = z.infer<typeof MakeAiIntakeResponse>;
