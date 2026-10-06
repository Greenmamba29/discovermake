import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, UNIVERSAL_STATUSES } from '@/contracts/enums';
import {
    assertTransition,
    canTransition,
    IllegalTransitionError,
    ORDER_STATUS_DISPLAY,
    ORDER_TRANSITIONS,
    toUniversalStatus,
} from '@/server/orders/state';

describe('order state machine', () => {
    it('defines transitions for every status', () => {
        for (const s of ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toBeDefined();
    });

    it('allows the happy path end to end', () => {
        const path = ['PENDING_PAYMENT', 'PAID', 'DISPATCHED', 'ACCEPTED', 'IN_PRODUCTION', 'QA_PASSED', 'SHIPPED', 'DELIVERED', 'COMPLETE'] as const;
        for (let i = 0; i < path.length - 1; i++) expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    });

    it('supports QA rework and decline re-dispatch', () => {
        expect(canTransition('IN_PRODUCTION', 'QA_FAILED')).toBe(true);
        expect(canTransition('QA_FAILED', 'IN_PRODUCTION')).toBe(true);
        expect(canTransition('DISPATCHED', 'PAID')).toBe(true);
    });

    it('blocks shipping without QA pass and skipping payment', () => {
        expect(() => assertTransition('IN_PRODUCTION', 'SHIPPED')).toThrow(IllegalTransitionError);
        expect(() => assertTransition('QA_FAILED', 'SHIPPED')).toThrow(IllegalTransitionError);
        expect(() => assertTransition('PENDING_PAYMENT', 'DISPATCHED')).toThrow(IllegalTransitionError);
        expect(() => assertTransition('COMPLETE', 'REFUNDED')).toThrow(IllegalTransitionError);
    });

    it('maps every status to the universal status language', () => {
        for (const s of ORDER_STATUSES) {
            expect(UNIVERSAL_STATUSES).toContain(toUniversalStatus(s));
            expect(ORDER_STATUS_DISPLAY[s].label.length).toBeGreaterThan(0);
        }
    });
});
