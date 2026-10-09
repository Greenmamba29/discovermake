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
import { createBuildWithCad } from './support/cad-build';
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
    /** A workspace whose build has generated CAD (Object View, Files, Ask Make AI). */
    cadWorkspaceUrl: string;
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
    /** App surface with the mobile bottom nav (Discover · Make · Builds · Me). Focused flows and consoles have none. */
    bottomNav?: boolean;
};

/** No Stripe in e2e: payout status answers 503 by design and the card falls back to manual settlement. */
const NO_STRIPE = /^503 \/api\/shop\/payouts\/status$/;
/** Onboarding progress as sessionStorage holds it, so each step can be opened directly. */
function onboardingAt(step: number) {
    return async (page: Page) => {
        await page.addInitScript((s) => {
            window.sessionStorage.setItem('dm_onboarding_v1', JSON.stringify({ step: s, intent: s > 0 ? 'make' : null, interests: s > 1 ? ['brackets-mounts', 'enclosures', 'robotics', 'desk-setup', 'bikes'] : [], firstBuild: null }));
        }, step);
    };
}

const SCREENS: Screen[] = [
    {
        name: 'home',
        mobbin: 'Uber · Booking a ride: one "What do you want to make?" bar, then Make-anything tiles',
        url: () => '/',
        bottomNav: true,
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1, name: 'What do you want to make?' })).toBeVisible();
            // One input bar: typed text for Make AI, attach/drop a DXF for an instant quote.
            await expect(page.getByTestId('intake-bar').getByRole('textbox', { name: 'Describe what you want to make' })).toBeVisible();
            await expect(page.getByTestId('upload-input')).toBeAttached();
            // Suggestions grid: Laser cut · Bend · CNC · 3D print · Wood · Reconstruct, every tile a real destination.
            const tiles = page.getByTestId('make-tiles').getByRole('listitem');
            await expect(tiles).toHaveCount(6);
            await expect(page.getByTestId('make-tiles').getByRole('link')).toHaveCount(6);
            for (const title of ['Laser cut', 'Bend', 'CNC', '3D print', 'Wood', 'Reconstruct']) await expect(page.getByTestId('make-tiles').getByText(title, { exact: true })).toBeVisible();
            // New visitors get an invitation to onboarding, not a redirect.
            await expect(page.getByTestId('tour-start')).toBeVisible();
        },
    },
    {
        name: 'onboarding-intent',
        mobbin: 'Blinkist · Onboarding: "Step 1 of 4" progress bar and a goals question',
        url: () => '/onboarding',
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1, name: 'What brings you here?' })).toBeVisible();
            await expect(page.getByTestId('onboarding-progress')).toHaveText('Step 1 of 4');
            await expect(page.getByRole('progressbar', { name: 'Onboarding progress' })).toBeVisible();
            await expect(page.getByRole('radio')).toHaveCount(4);
            await expect(page.getByTestId('onboarding-back')).toBeVisible();
            await expect(page.getByTestId('onboarding-skip')).toBeVisible();
        },
    },
    {
        name: 'onboarding-pick5',
        mobbin: 'Pinterest · Onboarding: "Pick 5 to customize your home feed" grid with checkmarks',
        url: () => '/onboarding',
        before: onboardingAt(1),
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1, name: 'Pick 5 things you love to make' })).toBeVisible();
            await expect(page.getByRole('checkbox')).toHaveCount(16);
            await expect(page.getByTestId('interest-count')).toHaveText('0 of 5 picked');
            await expect(page.getByTestId('onboarding-continue')).toBeDisabled();
        },
    },
    {
        name: 'onboarding-first-build',
        mobbin: 'Workflow 10 onboarding step 3: the sample part gets a real price and trust level in under 5 s',
        url: () => '/onboarding',
        before: onboardingAt(2),
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1, name: 'A real price in seconds' })).toBeVisible();
            await expect(page.getByTestId('first-build-price')).toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('first-build').getByTestId('trust-chip')).toContainText('Binding quote');
            await expect(page.getByText('Use my own file')).toBeVisible();
        },
    },
    {
        name: 'onboarding-save',
        mobbin: 'Behance · Onboarding: deferred signup, account created only to save',
        url: () => '/onboarding',
        before: onboardingAt(3),
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1, name: 'Save your build' })).toBeVisible();
            await expect(page.getByTestId('onboarding-passkey')).toHaveAttribute('href', '/signin?mode=create&next=/builds');
            await expect(page.getByTestId('onboarding-not-now')).toHaveAttribute('href', '/');
        },
    },
    {
        name: 'discover',
        mobbin: 'Pinterest home feed / Behance creative fields: interest chips over a masonry grid of starters',
        url: () => '/discover',
        bottomNav: true,
        pattern: async (page) => {
            await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
            await expect(page.getByTestId('interest-filters').getByRole('button')).toHaveCount(17);
            expect(await page.getByTestId('discover-grid').getByRole('article').count()).toBeGreaterThanOrEqual(12);
            // Every card starts a real flow: an instant quote or a Make AI brief.
            await expect(page.getByTestId('discover-start-wall-bracket')).toBeVisible();
            await expect(page.getByTestId('discover-start-drone-frame')).toHaveAttribute('href', /^\/make\/ai\?prompt=/);
        },
    },
    {
        name: 'make-upload',
        bottomNav: true,
        mobbin: 'Uber · "Where to?": single entry point for what you want to make',
        url: () => '/make',
        pattern: async (page) => {
            await expect(page.getByTestId('upload-input')).toBeAttached();
        },
    },
    {
        name: 'make-ai',
        bottomNav: true,
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
        bottomNav: true,
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
        bottomNav: true,
        mobbin: 'Uber · ride in progress: one plain status sentence, ETA first, the shop visible',
        url: (u) => u.orderUrl,
        pattern: async (page) => {
            await expect(page.getByTestId('order-status')).toBeVisible();
            await expect(page.getByTestId('passport-card')).toBeVisible();
        },
    },
    {
        name: 'production-run',
        bottomNav: true,
        mobbin: 'DoorDash · order status sheet: icon progress stages',
        url: (u) => u.productionUrl,
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        },
    },
    {
        name: 'orders',
        bottomNav: true,
        mobbin: 'Uber · Activity: find past orders',
        url: () => '/orders',
        pattern: async (page) => {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        },
    },
    {
        name: 'passport',
        bottomNav: true,
        mobbin: 'Digital certificate of authenticity with QR',
        url: (u) => u.passportUrl,
        pattern: async (page) => {
            await expect(page.getByTestId('passport-verified')).toBeVisible();
            await expect(page.locator('svg, img').first()).toBeVisible();
            // Workflow 09 commercial hook: one-tap replacement part.
            await expect(page.getByTestId('passport-order-replacement')).toBeVisible();
        },
    },
    {
        name: 'build-workspace',
        bottomNav: true,
        mobbin: 'Build Workspace: properties panel, version history with compare',
        url: (u) => u.workspaceUrl,
        pattern: async (page) => {
            await expect(page.getByTestId('workspace-status-strip')).toBeVisible();
            await expect(page.getByTestId('build-trust-badge')).toBeVisible();
            await expect(page.getByTestId('workspace-cad')).toBeVisible();
        },
    },
    {
        name: 'object-view',
        mobbin: 'Microsoft Copilot · 3D object with a Recreate / Download panel',
        url: (u) => `${u.cadWorkspaceUrl}?section=object`,
        pattern: async (page) => {
            // A 3D viewer (WebGL canvas, or the 2D fallback without WebGL) beside a properties panel.
            await expect(page.getByTestId('object-viewport')).toBeVisible();
            await expect(page.locator('[data-testid="object-viewport"] canvas').or(page.getByTestId('object-fallback')).first()).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('object-properties')).toBeVisible();
            await expect(page.getByTestId('object-dimensions')).toContainText('80.0 mm');
            await expect(page.getByTestId('object-download-panel').getByRole('link')).toHaveCount(3);
            await expect(page.getByTestId('object-ask-make-ai')).toBeVisible();
            await expect(page.getByRole('group', { name: 'Units' })).toBeVisible();
        },
    },
    {
        name: 'workspace-files',
        mobbin: 'Attachment tray: file tiles with thumbnails, type icons and progress',
        url: (u) => `${u.cadWorkspaceUrl}?section=attachments`,
        pattern: async (page) => {
            await expect(page.getByTestId('attachment-tray')).toBeVisible();
            await expect(page.getByTestId('attachment-add')).toBeVisible();
            await expect(page.getByTestId('attachment-input')).toBeAttached();
        },
    },
    {
        name: 'workspace-ask-make-ai',
        mobbin: 'LinkedIn · quick replies above the composer (Make AI panel, honest unavailable state without a key)',
        url: (u) => `${u.cadWorkspaceUrl}?section=assistant`,
        pattern: async (page) => {
            await expect(page.getByTestId('workspace-assistant')).toBeVisible();
            await expect(page.getByTestId('assistant-unavailable').or(page.getByTestId('assistant-form')).first()).toBeVisible();
            await expect(page.getByTestId('assistant-manual')).toBeVisible();
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
        bottomNav: true,
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
    const withCad = await createBuildWithCad(request);
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
        cadWorkspaceUrl: withCad.workspaceUrl,
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

                // App shell: the bottom nav on phone app screens only, never on desktop.
                const bottomNav = page.getByTestId('bottom-nav');
                if (viewport === 'phone' && screen.bottomNav) {
                    await expect(bottomNav).toBeVisible();
                    await expect(bottomNav.getByRole('link')).toHaveCount(4);
                    expect(await bottomNav.locator('[aria-current="page"]').count()).toBeLessThanOrEqual(1);
                } else if (viewport === 'phone') {
                    await expect(bottomNav).toHaveCount(0);
                } else {
                    await expect(bottomNav).toBeHidden();
                }

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
