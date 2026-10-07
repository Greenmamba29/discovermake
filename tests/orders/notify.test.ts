import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { notify, RESEND_API_URL } from '@/server/notify';
import { escapeHtml, renderEmail } from '@/server/notify/templates';

describe('notify', () => {
    afterEach(() => {
        delete process.env.RESEND_API_KEY;
        delete process.env.OPS_EMAIL;
        resetEnvCache();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const confirmed = {
        to: 'maker@example.com',
        orderId: 'ord_abc',
        orderNumber: 'DMO-7K3QX9',
        orderUrl: 'http://localhost:3100/orders/ord_abc?t=dmo_secret_token',
        totalCents: 7900,
        currency: 'usd',
    };

    it('console adapter by default, with the order-link token redacted from logs', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const r = await notify('order.confirmed', confirmed);
        expect(r).toMatchObject({ delivered: true, adapter: 'console' });
        const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
        expect(logged).toContain('DMO-7K3QX9');
        expect(logged).toContain('$79.00');
        expect(logged).not.toContain('dmo_secret_token');
    });

    it('sends through Resend with an idempotency key when RESEND_API_KEY is set', async () => {
        process.env.RESEND_API_KEY = 're_test_key';
        resetEnvCache();
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await notify('order.shipped', { to: 'maker@example.com', orderId: 'ord_abc', orderNumber: 'DMO-1', carrier: 'UPS', trackingNumber: '1Z999', trackingUrl: 'https://ups.com/t/1Z999' });
        expect(r).toEqual({ delivered: true, adapter: 'resend', id: 'email_123' });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(RESEND_API_URL);
        const headers = init.headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer re_test_key');
        expect(headers['idempotency-key']).toBe('order.shipped:ord_abc');
        const body = JSON.parse(String(init.body));
        expect(body.to).toEqual(['maker@example.com']);
        expect(body.subject).toBe('DMO-1 has shipped');
    });

    it('never rejects: provider errors and network failures resolve delivered=false', async () => {
        process.env.RESEND_API_KEY = 're_test_key';
        resetEnvCache();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
        await expect(notify('order.delivered', { to: 'a@b.co', orderId: 'o', orderNumber: 'n', passportUrl: null })).resolves.toMatchObject({ delivered: false, adapter: 'resend' });
        vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNRESET'))));
        await expect(notify('order.delivered', { to: 'a@b.co', orderId: 'o', orderNumber: 'n', passportUrl: null })).resolves.toMatchObject({ delivered: false });
    });

    it('ops alerts go to OPS_EMAIL; without it they are logged', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const r = await notify('ops.alert', { subject: 'No shop', message: 'help', orderId: 'ord_1' });
        expect(r.delivered).toBe(false);
        expect(info).toHaveBeenCalled();
        process.env.OPS_EMAIL = 'ops@example.com';
        resetEnvCache();
        const r2 = await notify('ops.alert', { subject: 'No shop', message: 'help' });
        expect(r2.delivered).toBe(true);
    });

    it('escapes user content in HTML templates', () => {
        expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
        const email = renderEmail('shop.job_offered', { to: 's@x.co', shopName: '<b>Evil</b>', jobId: 'job_1', orderNumber: 'DMO-1', offerExpiresAt: '2026-10-06T12:00:00Z', consoleUrl: 'http://localhost:3100/shop/jobs/job_1' });
        expect(email.html).not.toContain('<b>Evil</b>');
        expect(email.html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
    });
});
