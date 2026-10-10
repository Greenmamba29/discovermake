/**
 * Kids & Family tour (phone): a grown-up sets up Family, hands the phone to Mia, Mia makes a name
 * keychain and asks, the grown-up says yes and pays, and Mia watches it being made. Real app, real
 * state; the only seam is the workshop output (no CAD worker in tours), planted like the e2e spec.
 */
import { expect, test } from '@playwright/test';
import { payOrder } from '../e2e/support/journeys';
import { KIDS_PIN, plantGoldenKidCad } from '../e2e/support/kids';
import { endTour, note, PHONE, point, say, shows, startTour, titleCard, type } from './support/narrate';

test('13 · Kids & Family: make it, ask a grown-up, get it made (phone)', async ({ browser }) => {
    const email = `tour-family-${Date.now().toString(36)}@example.com`;
    const t = await startTour(browser, '13-kids-family-phone', { viewport: PHONE, total: 12, signInAs: { email, name: 'Sam Grown-Up' } });
    const { page } = t;

    await page.goto('/family');
    await titleCard(t, 'Kids & Family', 'Kids make it. Grown-ups say yes.', 'Kids design real things. A grown-up checks the price, says yes and pays.');
    await shows(page.getByRole('heading', { level: 1, name: 'Family' }));

    await say(t, 'A grown-up sets up Family', 'First, a secret 4-digit PIN. You need it to leave Kids mode.');
    await type(t, page.getByTestId('family-pin-input'), KIDS_PIN);
    await point(t, page.getByTestId('family-pin-save'));
    await expect(page.getByTestId('family-pin-status')).toHaveText('Set');

    await say(t, 'Add a kid', 'Just a nickname, an age and a picture. No email, no photo, no address.');
    await type(t, page.getByTestId('kid-nickname'), 'Mia');
    await point(t, page.getByTestId('kid-age-10-12'));
    await point(t, page.getByTestId('kid-avatar-owl'));
    await point(t, page.getByTestId('kid-add'));
    await shows(page.getByTestId('kid-card-mia'));

    await say(t, 'Hand the phone to Mia', 'Kids mode locks the grown-up parts of the app.');
    await point(t, page.getByTestId('kid-card-mia').getByRole('button', { name: 'Hand to Mia' }));
    await page.waitForURL(/\/kids$/);
    await shows(page.getByTestId('kid-hello'));

    await say(t, 'Pick something to make', 'Big pictures. One tap.');
    await point(t, page.getByTestId('kid-tile-name_keychain'));
    await page.waitForURL(/\/kids\/make\/name_keychain$/);

    await say(t, 'Type your words', 'Up to 12 letters. The drawing changes as you type.');
    await type(t, page.getByTestId('kid-label-input'), 'MIA');
    await point(t, page.getByTestId('kid-next'));
    await say(t, 'Pick a color', 'Every color has its name.');
    await point(t, page.getByTestId('kid-color-blue'));
    await point(t, page.getByTestId('kid-next'));
    await point(t, page.getByTestId('kid-next'));

    await shows(page.getByTestId('kid-offline'));
    await note(t, 'The workshop is offline', 'We never guess a price. (In this video we bring the workshop back.)');
    await plantGoldenKidCad(email);
    await point(t, page.getByTestId('kid-try-again'));
    await shows(page.getByTestId('kid-price'));
    await say(t, 'See the real price', 'A grown-up needs to say yes.', 3600);
    await point(t, page.getByTestId('kid-ask'));
    await shows(page.getByTestId('kid-asked'));
    await say(t, 'Asked!', 'The grown-up gets an email. Mia never needs one.');

    await page.goto('/checkout/qte_nope');
    await expect(page).toHaveURL(/\/kids$/);
    await say(t, 'Grown-up pages are locked', 'Trying to pay or change settings brings Mia back to Kids mode.');

    await point(t, page.getByTestId('kid-nav-exit'));
    await page.waitForURL(/\/kids\/exit$/);
    await say(t, 'Grown-ups only', 'The grown-up types the PIN to leave Kids mode.');
    for (const d of KIDS_PIN) await point(t, page.getByTestId(`kid-pin-${d}`), { pause: 250 });
    await page.waitForURL(/\/family$/, { timeout: 30_000 });

    const request = page.getByTestId('family-request').first();
    await shows(request);
    await say(t, 'Say yes and pay', 'The grown-up sees the design and the price, then pays with their own checkout. Prime benefits apply.');
    await point(t, request.getByTestId('family-approve'));
    await page.waitForURL(/\/checkout\/qte_/);
    await payOrder(page);

    await page.goto('/family');
    await point(t, page.getByTestId('kid-card-mia').getByRole('button', { name: 'Hand to Mia' }));
    await page.waitForURL(/\/kids$/);
    await point(t, page.getByTestId('kid-nav-things'));
    await page.waitForURL(/\/kids\/things$/);
    await expect(page.getByTestId('kid-thing-stage').first()).toHaveText('Yes! It’s being made');
    await say(t, 'Yes! It’s being made', 'Mia can watch it go from being made, to on its way, to here.', 3800);

    await endTour(t, { title: 'Make it. Ask. Get it made.', body: 'Kids design. Grown-ups decide. Nothing about kids is shared.' });
});
