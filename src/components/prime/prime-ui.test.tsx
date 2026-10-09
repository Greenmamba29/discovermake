// @vitest-environment jsdom
/**
 * R3 buyer UI: the checkout shows "Arrives <date>" only when the promise fits, the supplier-route
 * tracker renders one sentence per step with the balance action, and offer cards turn a confirmed
 * route into a binding price.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderSupplierRouteView } from '@/contracts';
import { arrivalText } from '@/components/checkout/checkout-form';
import { RouteOfferCard } from '@/components/sourcing/route-offer-card';
import { quoteFor, routeOffer } from '../__fixtures__/contracts';
import { SupplierRouteTracker } from './supplier-route-tracker';

afterEach(() => cleanup());

describe('arrivalText', () => {
    const quote = quoteFor({ materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090', quantity: 10 });
    const option = quote.shippingOptions[0];

    it('shows the committed date only when its P90 fits; otherwise ship-date language', () => {
        expect(arrivalText({ ...quote, promise: [{ method: option.method, date: '2026-10-23', p90Date: '2026-10-22', show: true }] }, option)).toBe('Arrives Fri, Oct 23');
        expect(arrivalText({ ...quote, shipDate: '2026-10-16', promise: [{ method: option.method, date: '2026-10-23', p90Date: '2026-10-27', show: false }] }, option)).toBe('Ships by Fri, Oct 16');
    });

    it('quotes from before R3 keep their estimate', () => {
        expect(arrivalText({ ...quote, promise: undefined }, option)).toMatch(/^Arrives /);
    });
});

describe('SupplierRouteTracker', () => {
    const route: OrderSupplierRouteView = {
        label: 'Verified partner · Vietnam',
        legStatus: 'RECEIVED_AT_PARTNER',
        directShip: false,
        steps: [
            { key: 'PO_PLACED', sentence: 'Purchase order placed with a verified partner in Vietnam', state: 'done', at: '2026-10-01T10:00:00Z' },
            { key: 'IN_PRODUCTION_AT_SUPPLIER', sentence: 'Made by our partner in Vietnam', state: 'done', at: '2026-10-02T10:00:00Z' },
            { key: 'SHIPPED_INBOUND', sentence: 'Shipped to our partner in Philadelphia', state: 'done', at: '2026-10-10T10:00:00Z' },
            { key: 'RECEIVED_AT_PARTNER', sentence: 'Received and inspected by our partner in Philadelphia', state: 'done', at: '2026-10-20T10:00:00Z' },
            { key: 'SHIPPED_TO_YOU', sentence: 'Passed inspection · ready to ship to you', state: 'current', at: null },
            { key: 'DELIVERED', sentence: 'Delivered', state: 'upcoming', at: null },
        ],
        payment: { kind: 'DEPOSIT_BALANCE', depositCents: 100_000, balanceCents: 100_000, creditCents: 0, depositPaid: true, balancePaid: false, balancePayUrl: 'http://localhost/checkout/dev-pay?ref=devpay_x' },
    };

    it('one sentence per step and a pay-balance action while the balance is due', () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        render(<SupplierRouteTracker orderId="ord_x" token="t" route={route} currency="usd" />);
        expect(screen.getAllByRole('listitem')).toHaveLength(6);
        expect(screen.getByTestId('supplier-step-SHIPPED_TO_YOU').getAttribute('data-state')).toBe('current');
        fireEvent.click(screen.getByTestId('pay-balance'));
        expect(assign).toHaveBeenCalledWith('http://localhost/checkout/dev-pay?ref=devpay_x');
        vi.unstubAllGlobals();
    });

    it('no balance action once paid', () => {
        render(<SupplierRouteTracker orderId="ord_x" token="t" route={{ ...route, payment: { ...route.payment, balancePaid: true, balancePayUrl: null } }} currency="usd" />);
        expect(screen.queryByTestId('pay-balance')).toBeNull();
    });
});

describe('RouteOfferCard binding price', () => {
    it('a confirmed route offers "Get your binding price"', async () => {
        const onBindingQuote = vi.fn(async () => {});
        const offer = routeOffer({ status: 'SELECTED', trustLevel: 'SUPPLIER_CONFIRMED', selection: { approvalId: 'apr_x', status: 'APPROVED' } });
        render(<RouteOfferCard offer={offer} onBindingQuote={onBindingQuote} />);
        expect(screen.getByTestId('offer-selection-approved').textContent).toMatch(/nothing has been ordered or charged/);
        fireEvent.click(screen.getByTestId(`supplier-quote-${offer.id}`));
        expect(onBindingQuote).toHaveBeenCalledWith(offer.id);
    });
});
