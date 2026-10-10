/**
 * Buyer onboarding tours: getting started, instant quote to checkout, accounts and My Builds,
 * Make AI and the Build Workspace. Each test records one video.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL } from '../../playwright.config';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';
import { createBuildWithCad } from '../e2e/support/cad-build';
import { DESKTOP, endTour, note, PHONE, point, say, scroll, shows, startTour, titleCard, type } from './support/narrate';

const DXF = () => ({ name: 'wall-bracket.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });

test('01 · Getting started (phone)', async ({ browser }) => {
    const t = await startTour(browser, '01-getting-started-phone', { viewport: PHONE, total: 8 });
    const { page } = t;
    await page.goto('/');
    await titleCard(t, 'DiscoverMake · Welcome', 'Make real parts in minutes', 'A one-minute tour: tell us what you make and see a real price.');

    await shows(page.getByRole('heading', { level: 1, name: 'What do you want to make?' }));
    await say(t, 'This is Home', 'Upload a drawing, describe a part in words, or start from an idea. Tap "Take the tour" to set up your feed.');
    await point(t, page.getByTestId('tour-start'));
    await page.waitForURL('**/onboarding');

    await shows(page.getByRole('heading', { level: 1, name: 'What brings you here?' }));
    await say(t, 'Tell us why you’re here', 'Pick the option that fits. It tunes your feed and suggestions.');
    await point(t, page.getByTestId('intent-option-make'));
    await point(t, page.getByTestId('onboarding-continue'));

    await shows(page.getByRole('heading', { level: 1, name: 'Pick 5 things you love to make' }));
    await say(t, 'Pick five interests', 'Choose five topics. Continue unlocks at five.');
    for (const slug of ['brackets-mounts', 'enclosures', 'robotics', 'desk-setup', 'bikes']) await point(t, page.getByTestId(`interest-chip-${slug}`), { pause: 250 });
    await expect(page.getByTestId('interest-count')).toHaveText('5 picked');
    await point(t, page.getByTestId('onboarding-continue'));

    await shows(page.getByRole('heading', { level: 1, name: 'A real price in seconds' }));
    await shows(page.getByTestId('first-build-price'));
    await say(t, 'Your first build, priced', 'A real part, a real binding price from a partner shop, in a few seconds. No account needed.', 4000);
    await point(t, page.getByTestId('onboarding-continue'));

    await shows(page.getByRole('heading', { level: 1, name: 'Save your build' }));
    await say(t, 'Save it, or keep exploring', 'Create a passkey to keep your builds on every device, or tap "Not now". Guest builds stay on this device.');
    await point(t, page.getByTestId('onboarding-not-now'));
    await page.waitForURL((url) => url.pathname === '/');

    await say(t, 'Get around with the bottom bar', 'Discover · Make · Live · Builds · Me. One tap to each.');
    for (const key of ['discover', 'make', 'live', 'builds', 'me'] as const) {
        await point(t, page.getByTestId(`bottom-nav-${key}`));
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(900);
    }
    await say(t, 'Me', 'Sign in, manage passkeys and membership here.');
    await endTour(t, { title: 'You’re set up', body: 'Next: upload a part and order it.' });
});

test('02 · Instant quote to checkout (desktop)', async ({ browser }) => {
    const t = await startTour(browser, '02-instant-quote-and-checkout', { viewport: DESKTOP, total: 9 });
    const { page } = t;
    await page.goto('/make');
    await titleCard(t, 'Buyers · Make', 'Upload a part, get a binding price', 'From a DXF drawing to a paid order in about a minute.');

    await say(t, 'Upload your drawing', 'Drop a DXF here. We read units, outlines, holes, cut length and bends.');
    await page.getByTestId('upload-input').setInputFiles(DXF());
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 60_000 });
    await page.waitForTimeout(1500);

    await say(t, 'Your part, analysed', 'The preview shows the parsed geometry. Manufacturability checks run against versioned rules and give a 0–100 score with one-tap fixes.', 4200);
    await point(t, page.getByTestId('material-option-mat_al_6061'));
    await say(t, 'Choose a material', 'Aluminum 6061 here. Each material lists the thicknesses partner shops can cut.');
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await point(t, thickness);
    else await point(t, thickness, { click: false });
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
    await point(t, page.getByTestId('trust-chip'), { click: false });
    await say(t, 'A binding quote', '"Binding quote" means this price is guaranteed: computed on the server from the shop’s rate card, in whole cents, with a ship date.', 4200);
    const qty = page.getByRole('button', { name: 'Set quantity to 10', exact: true });
    if (await qty.count()) {
        await point(t, qty);
        await say(t, 'Quantity pricing', 'The ladder shows the unit price at each quantity. Setup cost spreads across the run.');
    }
    await point(t, page.getByTestId('checkout-cta'));
    await page.waitForURL(/\/checkout\/qte_/);

    await say(t, 'Checkout', 'The server re-prices the order; your browser only sends ids. Guest checkout works, with no account needed.');
    await type(t, page.getByTestId('checkout-email'), 'alex@example.com');
    await type(t, page.getByTestId('checkout-name'), 'Alex Rivera');
    await type(t, page.getByTestId('checkout-line1'), '1 Market St');
    await type(t, page.getByTestId('checkout-city'), 'San Francisco');
    await page.getByTestId('checkout-region').selectOption('CA');
    await type(t, page.getByTestId('checkout-postal'), '94105');
    await point(t, page.getByTestId('shipping-option-STANDARD'));
    await page.getByTestId('checkout-terms').check();
    await say(t, 'Pay securely', 'Production uses Stripe Checkout (card, ACH, wallets). This demo uses the test payment screen.');
    await point(t, page.getByTestId('pay-cta'));
    await point(t, page.getByTestId('dev-pay-button'));
    await page.waitForURL(/\/orders\/ord_[A-Za-z0-9_-]+\?t=/, { timeout: 60_000 });
    await expect(page.getByTestId('order-status')).toContainText(/waiting for the shop/i, { timeout: 30_000 });

    await say(t, 'Your order', 'Payment is confirmed by a signed webhook and the order goes to the best capable partner shop. This private link is your tracking page, and we email it too.', 4500);
    await scroll(t, 500);
    await note(t, 'Every step is tracked', 'Accepted → in production → inspected → shipped → delivered, each with a time stamp.');
    await endTour(t, { title: 'Ordered', body: 'Next: track it, and get a Product Passport on delivery.' });
});

test('03 · Accounts, passkeys and My Builds (desktop)', async ({ browser }) => {
    const t = await startTour(browser, '03-accounts-and-my-builds', { viewport: DESKTOP, total: 8 });
    const { page, context } = t;
    const email = `tour-${Date.now().toString(36)}@example.com`;
    // A guest order to own (not narrated: the previous tour shows it).
    await page.goto('/make');
    await page.getByTestId('upload-input').setInputFiles(DXF());
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 60_000 });
    const partId = page.url().split('/').pop()!;
    await page.getByTestId('material-option-mat_al_6061').click();
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 30_000 });
    const buildId: string = (await (await page.request.get(`/api/parts/${partId}`)).json()).buildId;

    await page.goto('/builds');
    await titleCard(t, 'Buyers · Accounts', 'Keep your builds everywhere', 'Start as a guest, then sign in with an email code or a passkey. Your builds come with you.');
    await shows(page.getByRole('heading', { level: 1, name: 'My builds' }));
    await say(t, 'My Builds', 'Every part you make is a build. As a guest your builds live on this device, and the banner offers to keep them.');
    await point(t, page.getByTestId(`build-row-${buildId}`), { click: false });
    await say(t, 'Reorder · Remix · Repair', 'Each row has one-tap actions: reorder at today’s price, remix into your own version, or repair a part.');
    await point(t, page.getByTestId('builds-guest-signin'));
    await page.waitForURL(/\/signin/);

    await say(t, 'Sign in with an email code', 'No password. We email a 6-digit code (shown on screen in this demo).');
    await type(t, page.getByTestId('signin-email'), email);
    await point(t, page.getByTestId('signin-email-submit'));
    const devCode = (await page.getByTestId('signin-dev-code').locator('.font-mono').textContent())!.trim();
    await type(t, page.getByTestId('signin-code'), devCode);
    await point(t, page.getByTestId('signin-code-submit'));
    await page.waitForURL(/\/builds$/);
    await shows(page.getByTestId(`build-row-${buildId}`));
    await say(t, 'Your guest builds are now yours', 'Signing in claims everything you made on this device, including orders.');

    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await page.goto('/me');
    await say(t, 'Add a passkey', 'Passkeys sign you in with Face ID, Touch ID or Windows Hello. Nothing to remember, nothing to phish.');
    await point(t, page.getByTestId('me-add-passkey'));
    await shows(page.getByTestId('me-passkey-added'));
    await point(t, page.getByTestId('me-signout'));
    await page.waitForURL(/\/signin/);
    await say(t, 'Sign back in with one tap', 'Choose "Sign in with a passkey". No email, no code.');
    await point(t, page.getByTestId('signin-passkey'));
    await page.waitForURL(/\/builds$/, { timeout: 30_000 });
    await say(t, 'Back in your builds', 'Same builds, same orders, on any device where you use your passkey.');
    await endTour(t, { title: 'Your account', body: 'Email codes or passkeys. Google and Apple when enabled.' });
});

test('04 · Make AI and the Build Workspace (desktop)', async ({ browser }) => {
    const t = await startTour(browser, '04-make-ai-and-build-workspace', { viewport: DESKTOP, total: 9 });
    const { page } = t;
    await page.goto('/');
    await titleCard(t, 'Buyers · Make AI', 'Describe it, we plan it', 'Turn a sentence into a build plan, answer a few questions, approve and order.');

    await say(t, 'Start with words', 'No drawing? Describe the part on Home.');
    await type(t, page.getByTestId('intake-text'), 'A powder-coated steel wall bracket for a 600 mm shelf, 4 of them');
    await page.getByTestId('intake-text').press('Enter');
    await page.waitForURL(/\/make\/ai\?prompt=/);
    await say(t, 'Make AI', 'Make AI turns your words into a structured plan: requirements, materials, processes, and the questions it still needs answered.', 4000);

    // A stored plan, exactly as intake persists it (no model call in the demo).
    const intentId = randomUUID();
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        await sql`insert into make_intents (id, intent, model, prompt_sha256, prompt_chars) values (${intentId}, ${sql.json({
            intent: 'create',
            product_type: 'wall shelf bracket',
            summary: 'A bent steel bracket for a 600 mm wall shelf.',
            requirements: [{ id: 'R1', text: 'Holds a 10 kg shelf', category: 'function', source: 'user', confidence: 0.9 }],
            constraints: [],
            unknowns: [
                { question: 'What are the leg lengths and width of the bracket?', why_it_matters: 'Every cut depends on real measurements.' },
                { question: 'How many brackets do you need?', why_it_matters: 'Quantity changes setup cost per unit.', suggested_default: '4' },
            ],
            materials_suggested: [{ material: 'Mild steel', why: 'Strong and bends well.' }],
            processes_suggested: ['Laser cutting', 'Bending', 'Powder coating'],
            risk_class: 'standard',
            required_specialists: [],
        })}, ${'tour'}, ${'0'.repeat(64)}, ${64})`;
    } finally {
        await sql.end();
    }
    const { buildId } = await (await page.request.post('/api/make-ai/builds', { data: { intentId } })).json();
    await page.goto(`/build/${buildId}/workspace`);
    await shows(page.getByTestId('workspace-status-strip'));
    await say(t, 'The Build Workspace', 'Every build is versioned. The strip shows its stage, trust level and open questions.');

    await point(t, page.getByTestId('section-questions'));
    await say(t, 'Answer what’s missing', 'Nothing is guessed. Make AI asks for real measurements, and you can take a suggested default.');
    const dims = page.locator('[data-testid^="question-"]').filter({ hasText: 'leg lengths' });
    await type(t, dims.getByRole('textbox'), 'Legs 50 mm and 80 mm, 40 mm wide');
    await point(t, dims.getByRole('button', { name: 'Save answer' }));
    const qty = page.locator('[data-testid^="question-"]').filter({ hasText: 'How many' });
    await point(t, qty.getByRole('button', { name: 'Use this default' }));
    await expect(page.getByTestId('workspace-open-questions')).toContainText('None open', { timeout: 20_000 });

    await point(t, page.getByTestId('section-versions'));
    await say(t, 'Approve a version', 'Approving freezes the version. Approved designs can’t change, so what you order is exactly what you approved.');
    const version: number = (await (await page.request.get(`/api/builds/${buildId}/graph`)).json()).build.currentVersion;
    await point(t, page.getByTestId(`approve-v${version}`));
    await point(t, page.getByTestId(`approve-v${version}-confirm`));
    await expect(page.getByTestId(`approve-v${version}`)).toHaveCount(0, { timeout: 20_000 });

    const cad = await createBuildWithCad(page.request);
    await page.goto(`${cad.workspaceUrl}?section=object`);
    await shows(page.getByTestId('object-dimensions'));
    await say(t, 'Object View', 'When CAD is ready, see the part in 3D with its overall size written out, in mm or inches.', 3500);
    await point(t, page.getByTestId('object-unit-in'));
    await page.waitForTimeout(800);
    const measure = page.getByTestId('object-measure');
    if (await measure.isVisible()) {
        await point(t, measure);
        await say(t, 'Measure and inspect', 'Click two points to measure. Toggle wireframe, and download STEP, DXF or GLB.');
        await point(t, page.getByTestId('object-wireframe'));
    } else {
        await say(t, 'Downloads', 'Download STEP, DXF or GLB files for your own CAD tools.');
    }
    await point(t, page.getByTestId('object-download-STEP'), { click: false });
    await page.waitForTimeout(800);
    await endTour(t, { title: 'From words to a part', body: 'Answer, approve, and order from the same workspace.' });
});
