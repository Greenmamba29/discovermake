// @vitest-environment jsdom
/**
 * Onboarding step logic (workflow 10): Pick-5 gating (5 required, up to 16), Back/Skip,
 * resume from sessionStorage after a refresh, best-effort PUT /api/me/preferences.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEREST_SLUGS } from '@/contracts/account';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => '/onboarding' }));

import { OnboardingFlow } from './onboarding-flow';
import {
    INITIAL_STATE,
    MAX_INTERESTS,
    ONBOARDING_STORAGE_KEY,
    back,
    canContinue,
    interestsNeeded,
    loadState,
    next,
    saveState,
    selectIntent,
    toggleInterest,
    type OnboardingState,
} from './onboarding-state';

const puts: unknown[] = [];

beforeEach(() => {
    puts.length = 0;
    nav.push.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input) === '/api/me/preferences' && init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
            // The account API may not be deployed yet: onboarding must not care.
            return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nope' } }), { status: 404 });
        }),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('onboarding state', () => {
    it('step 1 needs an intent', () => {
        expect(canContinue(INITIAL_STATE)).toBe(false);
        expect(canContinue(selectIntent(INITIAL_STATE, 'make'))).toBe(true);
    });

    it('step 2 needs five interests, counts down, and caps at sixteen', () => {
        let s: OnboardingState = { ...INITIAL_STATE, step: 1 };
        for (const slug of INTEREST_SLUGS.slice(0, 4)) s = toggleInterest(s, slug);
        expect(canContinue(s)).toBe(false);
        expect(interestsNeeded(s)).toBe(1);
        s = toggleInterest(s, INTEREST_SLUGS[4]);
        expect(canContinue(s)).toBe(true);
        expect(interestsNeeded(s)).toBe(0);
        // Unpicking drops back below the gate.
        expect(canContinue(toggleInterest(s, INTEREST_SLUGS[0]))).toBe(false);
        for (const slug of INTEREST_SLUGS) s = toggleInterest({ ...s, interests: s.interests.filter((x) => x !== slug) }, slug);
        expect(s.interests).toHaveLength(MAX_INTERESTS);
        expect(new Set(s.interests).size).toBe(MAX_INTERESTS);
    });

    it('next/back stay within the four steps', () => {
        expect(back(INITIAL_STATE).step).toBe(0);
        expect(next(next(next(next(INITIAL_STATE)))).step).toBe(3);
    });

    it('round-trips through storage and ignores corrupt or foreign data', () => {
        const s: OnboardingState = { ...INITIAL_STATE, step: 2, intent: 'sell', interests: ['garden', 'bikes'] };
        saveState(sessionStorage, s);
        expect(loadState(sessionStorage)).toEqual(s);
        sessionStorage.setItem(ONBOARDING_STORAGE_KEY, '{nope');
        expect(loadState(sessionStorage)).toEqual(INITIAL_STATE);
        sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ ...s, interests: ['not-a-slug'] }));
        expect(loadState(sessionStorage)).toEqual(INITIAL_STATE);
        expect(loadState(null)).toEqual(INITIAL_STATE);
    });
});

describe('OnboardingFlow', () => {
    it('intent → pick 5 gating → saved preferences; progress resumes after a refresh', async () => {
        const { unmount } = render(<OnboardingFlow />);
        expect(await screen.findByRole('heading', { level: 1, name: 'What brings you here?' })).toBeTruthy();
        expect(screen.getByTestId('onboarding-progress').textContent).toBe('Step 1 of 4');
        const cont = screen.getByTestId('onboarding-continue') as HTMLButtonElement;
        expect(cont.disabled).toBe(true);
        fireEvent.click(screen.getByLabelText(/make something/i));
        expect(cont.disabled).toBe(false);
        fireEvent.click(cont);

        expect(await screen.findByRole('heading', { level: 1, name: 'Pick 5 things you love to make' })).toBeTruthy();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })));
        expect(puts).toContainEqual({ intent: 'make' });
        const c2 = () => screen.getByTestId('onboarding-continue') as HTMLButtonElement;
        for (const label of ['Robotics', 'Drones', 'Bikes']) fireEvent.click(screen.getByLabelText(label));
        expect(screen.getByTestId('interest-count').textContent).toBe('3 of 5 picked');
        expect(screen.getByText('Pick 2 more to continue')).toBeTruthy();
        expect(c2().disabled).toBe(true);

        // A refresh mid-step resumes on the same step with the same picks.
        unmount();
        render(<OnboardingFlow />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Pick 5 things you love to make' })).toBeTruthy();
        expect(screen.getByTestId('interest-count').textContent).toBe('3 of 5 picked');
        expect((screen.getByLabelText('Robotics') as HTMLInputElement).checked).toBe(true);

        fireEvent.click(screen.getByLabelText('Camping'));
        fireEvent.click(screen.getByLabelText('Garden'));
        expect(screen.getByTestId('interest-count').textContent).toBe('5 picked');
        expect(c2().disabled).toBe(false);
        fireEvent.click(screen.getByLabelText('Audio'));
        expect(screen.getByTestId('interest-count').textContent).toBe('6 picked');
        fireEvent.click(c2());
        expect(puts).toContainEqual({ interests: ['robotics', 'drones', 'bikes', 'camping', 'garden', 'audio'] });
        expect(await screen.findByRole('heading', { level: 1, name: 'A real price in seconds' })).toBeTruthy();
    });

    it('Back on the first step returns home; Skip moves on without an answer', async () => {
        render(<OnboardingFlow />);
        await screen.findByRole('heading', { level: 1, name: 'What brings you here?' });
        fireEvent.click(screen.getByTestId('onboarding-skip'));
        expect(await screen.findByRole('heading', { level: 1, name: 'Pick 5 things you love to make' })).toBeTruthy();
        fireEvent.click(screen.getByTestId('onboarding-back'));
        expect(await screen.findByRole('heading', { level: 1, name: 'What brings you here?' })).toBeTruthy();
        fireEvent.click(screen.getByTestId('onboarding-back'));
        expect(nav.push).toHaveBeenCalledWith('/');
    });

    it('the save step offers a passkey signup and "Not now", and both complete onboarding', async () => {
        saveState(sessionStorage, { ...INITIAL_STATE, step: 3, intent: 'discover', interests: ['garden', 'bikes', 'audio', 'drones', 'robotics'] });
        render(<OnboardingFlow />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Save your build' })).toBeTruthy();
        expect(screen.getByTestId('onboarding-passkey').getAttribute('href')).toBe('/signin?mode=create&next=/builds');
        const notNow = screen.getByTestId('onboarding-not-now');
        expect(notNow.getAttribute('href')).toBe('/');
        await act(async () => {
            fireEvent.click(notNow);
        });
        expect(puts.at(-1)).toEqual({ intent: 'discover', interests: ['garden', 'bikes', 'audio', 'drones', 'robotics'], complete: true });
        expect(localStorage.getItem('dm_onboarded')).toBe('1');
        expect(sessionStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    });
});
