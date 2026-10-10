import { describe, expect, it } from 'vitest';
import { useTestDb as withTestDb } from '../support/db';
import { GET } from '@/app/api/health/route';
import { LEGAL_DOCS, LEGAL_SLUGS, legalEffectiveDate } from '@/lib/legal';

const nextConfig = require('../../next.config.js');

describe('GET /api/health', () => {
    withTestDb();

    it('reports ok with the database up and never leaks config values', async () => {
        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.checks.database).toBe('ok');
        expect(JSON.stringify(body)).not.toMatch(/sk_|secret|postgres:\/\//i);
    });
});

describe('security headers', () => {
    it('applies CSP, HSTS, nosniff and frame denial to every route', async () => {
        const rules = await nextConfig.headers();
        expect(rules[0].source).toBe('/:path*');
        const h = Object.fromEntries(rules[0].headers.map((x: { key: string; value: string }) => [x.key, x.value]));
        expect(h['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
        expect(h['Content-Security-Policy']).toMatch(/object-src 'none'/);
        expect(h['Strict-Transport-Security']).toMatch(/max-age=\d+/);
        expect(h['X-Content-Type-Options']).toBe('nosniff');
        expect(h['X-Frame-Options']).toBe('DENY');
    });
});

describe('legal documents', () => {
    it('stay drafts until an effective date is configured', () => {
        delete process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE;
        expect(legalEffectiveDate()).toBeNull();
        process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE = '2026-11-01';
        expect(legalEffectiveDate()).toBe('2026-11-01');
        process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE = 'soon';
        expect(legalEffectiveDate()).toBeNull();
        delete process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE;
    });

    it('has every document with sections', () => {
        for (const s of LEGAL_SLUGS) expect(LEGAL_DOCS[s].sections.length).toBeGreaterThan(2);
    });
});
