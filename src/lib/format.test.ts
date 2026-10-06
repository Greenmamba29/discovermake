import { describe, expect, it } from 'vitest';
import { dims, humanize, money, plural, shortDate } from './format';
import { parseOrderLink } from './recent-orders';

describe('format', () => {
    it('formats integer cents as USD', () => {
        expect(money(18900)).toBe('$189.00');
        expect(money(18900, 'usd', { compact: true })).toBe('$189');
        expect(money(5)).toBe('$0.05');
    });
    it('treats calendar dates as local dates (no timezone shift)', () => {
        expect(shortDate('2026-10-09')).toBe('Fri, Oct 9');
        expect(shortDate(null)).toBe('—');
    });
    it('formats dimensions, plurals and codes', () => {
        expect(dims(120, 80)).toBe('120.0 × 80.0 mm');
        expect(plural(1, 'issue')).toBe('1 issue');
        expect(plural(3, 'issue')).toBe('3 issues');
        expect(humanize('OUT_FOR_DELIVERY')).toBe('Out for delivery');
    });
});

describe('parseOrderLink', () => {
    it('accepts the signed buyer link and keeps the token', () => {
        expect(parseOrderLink('https://discovermake.com/orders/ord_abc123?t=dmo_tok')).toBe('/orders/ord_abc123?t=dmo_tok');
        expect(parseOrderLink('/orders/ord_abc123?token=x%2By')).toBe('/orders/ord_abc123?t=x%2By');
    });
    it('rejects links without an order id or token', () => {
        expect(parseOrderLink('https://discovermake.com/orders/ord_abc123')).toBeNull();
        expect(parseOrderLink('https://evil.example/passport/pps_1?t=1')).toBeNull();
        expect(parseOrderLink('')).toBeNull();
    });
});
