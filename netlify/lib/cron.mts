/**
 * Scheduled jobs on Netlify: each function in netlify/functions/cron-*.mts calls one admin route on
 * this deploy with `Authorization: Bearer $CRON_SECRET`, the same GET request Vercel Cron
 * sends (vercel.json). The routes do the work; a scheduled function only has 30 s, so it just triggers.
 */
export async function triggerCronRoute(route: string): Promise<Response> {
    const base = Netlify.env.get('URL');
    const secret = Netlify.env.get('CRON_SECRET');
    if (!base || !secret) {
        console.error(`[cron] ${route}: URL or CRON_SECRET is not set`);
        return new Response('not configured', { status: 500 });
    }
    const res = await fetch(new URL(route, base), {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(25_000),
    });
    const body = (await res.text()).slice(0, 500);
    console.log(`[cron] ${route} -> ${res.status} ${body}`);
    return new Response(body, { status: res.ok ? 200 : 502 });
}
