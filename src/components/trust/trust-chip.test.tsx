// @vitest-environment jsdom
/**
 * Trust language (workflow 03): every price carries one of four trust labels, and only a
 * binding quote reads as orderable. Build trust never lets a concept look production-ready.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILD_TRUST_STATES, TRUST_LEVELS } from '@/contracts';
import { BuildTrustBadge, BUILD_TRUST_COPY } from './build-trust-badge';
import { TRUST_COPY, TrustChip } from './trust-chip';

afterEach(cleanup);

describe('TrustChip', () => {
    it('labels the four trust levels with their orderability', () => {
        const expected = {
            AI_ESTIMATE: ['AI estimate', 'Not orderable'],
            SUPPLIER_ESTIMATE: ['Supplier estimate', 'Not orderable'],
            SUPPLIER_CONFIRMED: ['Supplier-confirmed', 'Orderable after approval'],
            BINDING: ['Binding quote', 'Orderable'],
        } as const;
        for (const level of TRUST_LEVELS) {
            const { unmount } = render(<TrustChip level={level} showOrderable />);
            expect(screen.getByTestId('trust-chip').textContent).toContain(expected[level][0]);
            expect(screen.getByTestId('trust-chip-orderable').textContent).toBe(expected[level][1]);
            unmount();
        }
        expect(Object.values(TRUST_COPY).filter((t) => t.orderable === 'yes')).toHaveLength(1);
    });

    it('explains the label to assistive tech and accepts a custom test id', () => {
        render(<TrustChip level="SUPPLIER_ESTIMATE" testId="offer-trust-chip" />);
        expect(screen.getByRole('button', { name: 'About Supplier estimate' })).toBeTruthy();
        expect(screen.getByRole('tooltip', { hidden: true }).textContent).toMatch(/cannot be ordered/);
        expect(screen.queryByTestId('trust-chip')).toBeNull();
        expect(screen.getByTestId('offer-trust-chip').getAttribute('data-trust')).toBe('SUPPLIER_ESTIMATE');
    });
});

describe('BuildTrustBadge', () => {
    it('walks CONCEPT → ORDERABLE in order', () => {
        expect(BUILD_TRUST_STATES.map((s) => BUILD_TRUST_COPY[s].label)).toEqual(['Concept', 'Engineering review', 'Manufacturing ready', 'Supplier confirmed', 'Orderable']);
    });

    it('never styles a concept like an orderable build', () => {
        const { unmount } = render(<BuildTrustBadge state="CONCEPT" showSteps />);
        const concept = screen.getByTestId('build-trust-badge');
        expect(concept.textContent).toContain('Not engineered for production');
        expect(concept.innerHTML).not.toMatch(/bg-signal(?!\/)/);
        expect(screen.getByRole('list', { name: /step 1 of 5, Concept/ })).toBeTruthy();
        unmount();

        render(<BuildTrustBadge state="ORDERABLE" showSteps />);
        expect(screen.getByRole('list', { name: /step 5 of 5, Orderable/ })).toBeTruthy();
    });
});
