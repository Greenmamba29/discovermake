/**
 * Onboarding state machine (workflow 10: Blinkist "Step 1 of 4" + Pinterest "Pick 5" +
 * Behance deferred signup). Pure: no React, no I/O except the Storage passed in, so the
 * gating and resume rules are unit-tested directly.
 */
import { z } from 'zod';
import { InterestSlug, OnboardingIntent } from '@/contracts/account';

export const ONBOARDING_STEPS = ['intent', 'interests', 'first-build', 'save'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const MIN_INTERESTS = 5;
export const MAX_INTERESTS = 16;

/** sessionStorage key: a refresh resumes where the visitor was. */
export const ONBOARDING_STORAGE_KEY = 'dm_onboarding_v1';
/** localStorage keys for the Home tour entry. */
export const TOUR_DISMISSED_KEY = 'dm_tour_dismissed';
export const ONBOARDED_KEY = 'dm_onboarded';

/** The instant quote from step 3, kept so a refresh shows it instead of re-uploading. */
export const FirstBuild = z.object({
    partId: z.string(),
    quoteId: z.string(),
    subtotalCents: z.number().int().nonnegative(),
    currency: z.string(),
    trustLevel: z.string(),
    orderable: z.boolean(),
    shipDate: z.string(),
    materialName: z.string(),
    thicknessLabel: z.string(),
    widthMm: z.number(),
    heightMm: z.number(),
    svgPath: z.string(),
    elapsedMs: z.number().nonnegative(),
});
export type FirstBuild = z.infer<typeof FirstBuild>;

export const OnboardingState = z.object({
    step: z.number().int().min(0).max(ONBOARDING_STEPS.length - 1),
    intent: OnboardingIntent.nullable(),
    interests: z.array(InterestSlug).max(MAX_INTERESTS),
    firstBuild: FirstBuild.nullable(),
});
export type OnboardingState = z.infer<typeof OnboardingState>;

export const INITIAL_STATE: OnboardingState = { step: 0, intent: null, interests: [], firstBuild: null };

export function stepName(state: OnboardingState): OnboardingStep {
    return ONBOARDING_STEPS[state.step];
}

/** "Continue" gating. Skip is always allowed and never needs this. */
export function canContinue(state: OnboardingState): boolean {
    switch (stepName(state)) {
        case 'intent':
            return state.intent !== null;
        case 'interests':
            return state.interests.length >= MIN_INTERESTS;
        default:
            return true;
    }
}

/** How many more interests are needed before Continue unlocks (0 once there are 5+). */
export function interestsNeeded(state: OnboardingState): number {
    return Math.max(0, MIN_INTERESTS - state.interests.length);
}

export function selectIntent(state: OnboardingState, intent: OnboardingIntent): OnboardingState {
    return { ...state, intent };
}

/** Toggle one interest; adding past the 16 cap is a no-op. Duplicates are impossible. */
export function toggleInterest(state: OnboardingState, slug: InterestSlug): OnboardingState {
    if (state.interests.includes(slug)) return { ...state, interests: state.interests.filter((s) => s !== slug) };
    if (state.interests.length >= MAX_INTERESTS) return state;
    return { ...state, interests: [...state.interests, slug] };
}

export function next(state: OnboardingState): OnboardingState {
    return { ...state, step: Math.min(state.step + 1, ONBOARDING_STEPS.length - 1) };
}

export function back(state: OnboardingState): OnboardingState {
    return { ...state, step: Math.max(state.step - 1, 0) };
}

/** Restore from storage; anything missing, corrupt or from an older shape starts fresh. */
export function loadState(storage: Pick<Storage, 'getItem'> | null | undefined): OnboardingState {
    try {
        const raw = storage?.getItem(ONBOARDING_STORAGE_KEY);
        if (!raw) return INITIAL_STATE;
        const parsed = OnboardingState.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : INITIAL_STATE;
    } catch {
        return INITIAL_STATE;
    }
}

export function saveState(storage: Pick<Storage, 'setItem'> | null | undefined, state: OnboardingState): void {
    try {
        storage?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Private mode / quota: onboarding still works, it just will not resume after a refresh.
    }
}

export function clearState(storage: Pick<Storage, 'removeItem'> | null | undefined): void {
    try {
        storage?.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
        // ignore
    }
}
