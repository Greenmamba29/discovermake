/**
 * Mobbin page sweep: every screen in the app, with real data on it, at phone (390×844)
 * and desktop (1280×800). For each screen:
 *   - renders without a Next error, console errors or page errors;
 *   - one h1 and a main landmark;
 *   - no horizontal scroll at phone width (workflow 10: 16px gutters, mobile-first);
 *   - axe (WCAG 2.1 A/AA): no serious or critical violations;
 *   - the Mobbin pattern it was designed from (workflows/10-frontend-mobbin-design.md)
 *     is actually present.
 * Screenshots and aria snapshots go to test-results/page-sweep/ for design review.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { E2E_ADMIN_TOKEN, E2E_DATABASE_URL } from '../../playwright.config';
import { adminLogin, fulfil, payOrder, quotePart, shopLogin } from './support/journeys';

const OUT = path.join(process.cwd(), 'test-results', 'page-sweep');
/** Written by global-setup once per run (the e2e database is recreated per run). */
const RUN_ID_FILE = path.join(process.cwd(), 'test-results', '.e2e-run-id');
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;
type Viewport = keyof typeof VIEWPORTS;

type Urls = {
    partUrl: string;
    checkoutUrl: string;
    routeUrl: string;
    orderUrl: string;
    productionUrl: string;
    passportUrl: string;
    jobUrl: string;
    workspaceUrl: string;
    sourcingJobUrl: string;
};

type Screen = {
    name: string;
    mobbin: string;
    url: (u: Urls) => string;
    /** Log in or otherwise prepare the page before navigating. */
    before?: (page: Page) => Promise<void>;
    /** The Mobbin pattern this screen was designed from. */
    pattern: (page: Page) => Promise<void>;
    /** Failed requests that are expected on this screen, matched against "<status> <path>". */
    allowHttp?: RegExp[];
};

/** No Stripe in e2e: payout status answers 503 by design and the card falls back to manual settlement. */
const NO_STRIPE = /^503 \/api\/shop\/payouts\/status$/;

const SCREENS: Screen[] = [
    {
        name: 'home',
        mobbin: 'Uber · Booking a ride: one primary input, then shortcuts',
        url: () => '/',
        pattern: async (page) => {
            await expect(page.getByTestId('upload-input')).toBeAttached();
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        },
    },
    {
        name: 'make-upload',
        mobbin: 'Uber · "Where to?": single entry point for what you want to make',
        url: () => '/make',
        pattern: async (page) => {
            await expect(page.getByTestId('upload-input')).toBeAttached();
        },
    },
    {
        name: 'make-ai',
        mobbin: 'Make intake: AI prompt composer',
        url: () => '/make/ai',
        pattern: async (page) => {
            await expect(page.getByRole('textbox').first()).toBeVisible();
        },
    },
    {
        name: 'configure-quote',
        mobbin: 'DoorDash · Adding to cart: required option groups, prices on rows, CTA counts missing choices',
        url: (u) => u.partUrl,
        pattern: async (page) => {
            await expect(page.getByText('Required', { exact: true }).first()).toBeVisible();
            // DoorDash: the sticky CTA counts the missing required choices.
            await expect(page.getByTestId('checkout-cta')).toContainText(/required selection/i);
        },
    },
    {
        name: 'manufacturing-route',
        mobbin: 'Route: compare vendor cards with ratings and lead time',
        url: (u) => u.routeUrl,
        pattern: async (page) => {
            await expect(page.getByText('Recommended').first()).toBeVisible();
            await expect(page.getByTestId('route-trust-chip').or(page.getByTestId('trust-chip')).first()).toBeVisible();
        },
    },
    {
        name: 'checkout',
        mobbin: 'DoorDash · Placing an order: fees explained with ⓘ, shipping-method cards with dates',
        url: (u) => u.checkoutUrl,
        pattern: async (page) => {
            await expect(page.getByTestId('shipping-option-STANDARD')).toBeVisible();
            await expect(page.getByRole('button', { name: /^About / }).first()).toBeAttached();
        },
    },
    {
        name: 'order-tracking',
        mobbin: 'Uber · ride in progress: one plain status sentence, ETA first, the shop visible',
        url: (u) => u.orderUrl,
        pattern: async (page) => {
            await expect(page.getByTestId('order-status')).toBeVisible();
            await expect(page.getByTestId('passport-card')).toBeVisible();
        },
    },
    {
        name: 'production-run',
        mobbin: 'DoorDash · order status sheet: icon progress stages',
        url: (u) => u.productionUrl,
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        },
    },
    {
        name: 'orders',
        mobbin: 'Uber · Activity: find past orders',
        url: () => '/orders',
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        },
    },
    {
        name: 'passport',
        mobbin: 'Digital certificate of authenticity with QR',
        url: (u) => u.passportUrl,
        pattern: async (page) => {
            await expect(page.getByTestId('passport-verified')).toBeVisible();
            await expect(page.locator('svg, img').first()).toBeVisible();
        },
    },
    {
        name: 'build-workspace',
        mobbin: 'Build Workspace: properties panel, version history with compare',
        url: (u) => u.workspaceUrl,
        pattern: async (page) => {
            await expect(page.getByTestId('workspace-status-strip')).toBeVisible();
            await expect(page.getByTestId('build-trust-badge')).toBeVisible();
            await expect(page.getByTestId('workspace-cad')).toBeVisible();
        },
    },
    {
        name: 'shop-login',
        mobbin: 'Shop Console sign-in',
        url: () => '/shop',
        // The console probes for an existing session before showing the sign-in form.
        allowHttp: [/^401 \/api\/shop\/session$/, NO_STRIPE],
        pattern: async (page) => {
            await expect(page.getByTestId('shop-token-input')).toBeVisible();
        },
    },
    {
        name: 'shop-jobs',
        allowHttp: [NO_STRIPE],
        mobbin: 'Driver app · job offer accept/decline; kitchen display queue',
        url: () => '/shop/jobs',
        before: shopLogin,
        pattern: async (page) => {
            await expect(page.getByTestId('jobs-tab-offered')).toBeVisible();
        },
    },
    {
        name: 'shop-job',
        allowHttp: [NO_STRIPE],
        mobbin: 'Kitchen display · one order: milestones, QA, ship',
        url: (u) => u.jobUrl,
        before: shopLogin,
        pattern: async (page) => {
            await expect(page.getByTestId('job-status-text')).toBeVisible();
        },
    },
    {
        name: 'shop-payouts',
        allowHttp: [NO_STRIPE],
        mobbin: 'Payouts / Stripe Connect status',
        url: () => '/shop/payouts',
        before: shopLogin,
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        },
    },
    {
        name: 'ops-board',
        mobbin: 'Ops board',
        url: () => '/admin',
        before: adminLogin,
        pattern: async (page) => {
            await expect(page.getByTestId('ops-sourcing-link')).toBeVisible();
        },
    },
    {
        name: 'sourcing-desk',
        mobbin: 'Sourcing desk: queue, approvals inbox',
        url: () => '/admin/sourcing',
        before: async (page) => {
            await page.goto('/admin/sourcing');
            await page.getByTestId('sourcing-admin-token-input').fill(E2E_ADMIN_TOKEN);
            await page.getByTestId('sourcing-admin-login-submit').click();
            await expect(page.getByTestId('sourcing-job-list')).toBeVisible();
        },
        pattern: async (page) => {
            await expect(page.getByTestId('sourcing-job-list')).toBeVisible();
        },
    },
    {
        name: 'sourcing-job',
        mobbin: 'Sourcing desk: job detail with offers and approvals',
        url: (u) => u.sourcingJobUrl,
        before: async (page) => {
            await page.goto('/admin/sourcing');
            await page.getByTestId('sourcing-admin-token-input').fill(E2E_ADMIN_TOKEN);
            await page.getByTestId('sourcing-admin-login-submit').click();
        },
        pattern: async (page) => {
            await expect(page.getByTestId('job-status')).toBeVisible();
        },
    },
    {
        name: 'signin',
        mobbin: 'Behance · deferred signup: sign in only to save; passkey or email code, no password',
        url: () => '/signin?next=/builds&mode=create',
        pattern: async (page) => {
            await expect(page.getByTestId('signin-email')).toBeVisible();
            await expect(page.getByTestId('signin-passkey')).toBeVisible();
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('Save your build');
        },
    },
    {
        name: 'me',
        mobbin: 'Account hub: profile, creator handle, passkeys, sign out',
        url: () => '/me',
        before: (page) => signInByEmail(page, 'sweep-me@example.com'),
        pattern: async (page) => {
            await expect(page.getByTestId('me-email')).toContainText('sweep-me@example.com');
            await expect(page.getByTestId('me-add-passkey')).toBeVisible();
            await expect(page.getByTestId('me-signout')).toBeVisible();
        },
    },
    {
        name: 'my-builds',
        mobbin: 'Yami · status tabs with counts + Glovo / Subway order-again rows (Reorder · Remix · Repair)',
        url: () => '/builds',
        // The sweep buyer's delivered order is claimed by email at sign-in.
        before: (page) => signInByEmail(page, 'sweep-buyer@example.com'),
        pattern: async (page) => {
            await expect(page.getByRole('tab')).toHaveCount(5);
            await expect(page.getByRole('tab', { name: /Ordered/ })).toBeVisible();
            const row = page.locator('[data-testid^="build-row-"]').first();
            await expect(row).toBeVisible();
            await expect(row.locator('[data-status]')).toBeVisible();
            for (const action of ['build-reorder', 'build-remix', 'build-repair']) await expect(row.getByTestId(action)).toBeVisible();
            await expect(row.getByTestId('build-reorder')).toBeEnabled();
        },
    },
    {
        name: 'not-found',
        mobbin: 'Empty / error state',
        allowHttp: [/^404 \/this-page-does-not-exist$/],
        url: () => '/this-page-does-not-exist',
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        },
    },
];

/** Sign this browser context in with an email code (dev returns the code). Own IP per call so in-memory limits never trip. */
async function signInByEmail(page: Page, email: string) {
    const headers = { 'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` };
    const start = await (await page.request.post('/api/auth/email/start', { data: { email }, headers })).json();
    const verified = await page.request.post('/api/auth/email/verify', { data: { challengeId: start.challengeId, code: start.devCode }, headers });
    expect(verified.ok(), 'email sign-in').toBe(true);
}

/** Builds real state once: a delivered order with a passport, a sourcing job, a Make AI workspace. */
async function buildState(browser: Browser): Promise<Urls> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const quoted = await quotePart(page);
    const { orderUrl, orderNumber } = await payOrder(page);
    const { jobUrl, passportUrl } = await fulfil(context, orderNumber, orderUrl);
    // A second, unpaid quote so the checkout screen is shown as a buyer first sees it.
    const fresh = await quotePart(page, 'sweep-checkout.dxf');
    const request = context.request;
    const part = await (await request.get(`/api/parts/${quoted.partId}`)).json();
    const buildId: string = part.buildId;
    const job = await (await request.post(`/api/builds/${buildId}/sourcing`, { data: { partId: quoted.partId, quantity: 100 } })).json();

    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    const intentId = randomUUID();
    try {
        await sql`insert into make_intents (id, intent, model, prompt_sha256, prompt_chars) values (${intentId}, ${sql.json({
            intent: 'create',
            product_type: 'desk organizer',
            summary: 'A bent aluminum desk organizer with two pen slots.',
            requirements: [{ id: 'R1', text: 'Holds pens and a phone', category: 'function', source: 'user', confidence: 0.9 }],
            constraints: [],
            unknowns: [{ question: 'How wide should it be?', why_it_matters: 'Sets the flat pattern size.' }],
            materials_suggested: [{ material: 'Aluminum 5052', why: 'Bends cleanly.' }],
            processes_suggested: ['Laser cutting', 'Bending'],
            risk_class: 'standard',
            required_specialists: [],
        })}, ${'e2e'}, ${'0'.repeat(64)}, ${10})`;
    } finally {
        await sql.end();
    }
    const made = await (await request.post('/api/make-ai/builds', { data: { intentId } })).json();
    await context.close();

    const [orderPath, query] = orderUrl.split('?');
    return {
        partUrl: quoted.partUrl,
        checkoutUrl: fresh.checkoutUrl,
        routeUrl: `/build/${buildId}/route?quote=${quoted.quoteId}`,
        orderUrl,
        productionUrl: `${orderPath}/production?${query}`,
        passportUrl,
        jobUrl,
        workspaceUrl: `/build/${made.buildId}/workspace`,
        sourcingJobUrl: `/admin/sourcing/jobs/${job.id}`,
    };
}

test.describe('Mobbin page sweep', () => {
    let urls: Urls;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(240_000);
        mkdirSync(OUT, { recursive: true });
        // A failed test restarts the worker and re-runs beforeAll: reuse this run's state.
        const runId = existsSync(RUN_ID_FILE) ? readFileSync(RUN_ID_FILE, 'utf8') : 'none';
        const cache = path.join(OUT, 'state.json');
        const cached = existsSync(cache) ? (JSON.parse(readFileSync(cache, 'utf8')) as { runId: string; urls: Urls }) : null;
        if (cached && cached.runId === runId) {
            urls = cached.urls;
        } else {
            urls = await buildState(browser);
            writeFileSync(cache, JSON.stringify({ runId, urls }));
        }
    });

    for (const screen of SCREENS) {
        for (const viewport of Object.keys(VIEWPORTS) as Viewport[]) {
            test(`${screen.name} · ${viewport}`, async ({ browser }) => {
                const context = await browser.newContext({ viewport: VIEWPORTS[viewport] });
                const page = await context.newPage();
                const problems: string[] = [];
                if (screen.before) await screen.before(page);
                page.on('console', (msg) => {
                    // Failed requests are reported below with their URL instead.
                    if (msg.type() === 'error' && !/Failed to load resource/i.test(msg.text())) problems.push(`console: ${msg.text()}`);
                });
                page.on('response', (r) => {
                    const hit = `${r.status()} ${new URL(r.url()).pathname}`;
                    if (r.status() >= 400 && !(screen.allowHttp ?? []).some((re) => re.test(hit))) problems.push(`http ${hit}`);
                });
                page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
                const target = screen.url(urls);
                const res = await page.goto(target);
                expect(res, `navigated to ${target}`).not.toBeNull();
                await expect(page.locator('main').first()).toBeVisible();
                await page.waitForTimeout(500); // let client data settle

                // Structure
                await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
                await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);

                // Mobbin pattern
                await screen.pattern(page);

                // No horizontal scroll, including with each ⓘ explainer open (tap on phones).
                const overflowPx = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
                expect(await overflowPx(), 'horizontal overflow (px)').toBeLessThanOrEqual(1);
                if (viewport === 'phone') {
                    const tips = page.getByRole('button', { name: /^About / });
                    for (let i = 0; i < Math.min(await tips.count(), 12); i++) {
                        const tip = tips.nth(i);
                        if (!(await tip.isVisible())) continue;
                        await tip.click();
                        expect(await overflowPx(), `horizontal overflow with explainer ${i} open (px)`).toBeLessThanOrEqual(1);
                        await page.keyboard.press('Escape');
                    }
                }

                // Accessibility
                const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
                const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
                const summary = serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`);
                appendFileSync(path.join(OUT, 'report.jsonl'), `${JSON.stringify({ screen: screen.name, viewport, mobbin: screen.mobbin, axe: summary, problems })}\n`);

                const base = path.join(OUT, `${screen.name}-${viewport}`);
                await page.screenshot({ path: `${base}.png`, fullPage: true });
                writeFileSync(`${base}.aria.yml`, await page.locator('body').ariaSnapshot());

                expect(summary, 'serious/critical axe violations').toEqual([]);
                expect(problems, 'console/page errors').toEqual([]);
                await context.close();
            });
        }
    }
});
