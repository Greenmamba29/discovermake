/**
 * Onboarding tours: real walk-throughs of the app recorded as videos, with an on-screen
 * caption, a title card and a visible cursor (Playwright videos do not show the pointer).
 * Everything happens in the real app against real state; nothing is mocked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Cookie, type Locator, type Page } from '@playwright/test';
import { signIn } from '../../e2e/support/live';

export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };
/** Raw recordings land here; `bun run videos:collect` converts them to MP4. */
export const RAW_DIR = path.join(process.cwd(), 'videos', 'raw', 'onboarding');

/** Caption box, title card and cursor, installed on every page load. */
function overlayScript() {
    const install = () => {
        if (document.getElementById('__tour-style')) return;
        const style = document.createElement('style');
        style.id = '__tour-style';
        style.textContent = `
            nextjs-portal { display: none !important; }
            #__tour-caption { position: fixed; left: 50%; transform: translateX(-50%); bottom: max(96px, 8vh); z-index: 2147483646;
                width: min(92vw, 760px); box-sizing: border-box; padding: 14px 18px; border-radius: 16px; pointer-events: none;
                background: rgba(12, 14, 18, 0.92); color: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.12);
                font: 500 15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; opacity: 0; transition: opacity .25s ease; }
            #__tour-caption.on { opacity: 1; }
            #__tour-caption b { display: block; font-size: 17px; font-weight: 700; margin-bottom: 2px; color: #ffd166; }
            #__tour-caption small { display: block; margin-top: 6px; font-size: 12px; color: rgba(255,255,255,.6); letter-spacing: .02em; }
            #__tour-card { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; text-align: center; padding: 24px;
                background: radial-gradient(120% 90% at 50% 10%, #2b2f3a 0%, #0c0e12 70%); color: #fff; pointer-events: none;
                font: 500 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; opacity: 0; transition: opacity .35s ease; }
            #__tour-card.on { opacity: 1; }
            #__tour-card h1 { margin: 0 0 10px; font-size: clamp(26px, 5vw, 46px); line-height: 1.1; font-weight: 800; letter-spacing: -.01em; }
            #__tour-card p { margin: 0 auto; max-width: 34ch; color: rgba(255,255,255,.75); }
            #__tour-card .eyebrow { margin-bottom: 14px; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #ffd166; }
            #__tour-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
                background: rgba(255, 209, 102, .35); border: 2px solid #ffd166; pointer-events: none; left: -50px; top: -50px;
                transition: left .12s linear, top .12s linear, transform .12s ease; }
            #__tour-cursor.down { transform: scale(.65); background: rgba(255, 209, 102, .8); }`;
        document.head.appendChild(style);
        const cursor = document.createElement('div');
        cursor.id = '__tour-cursor';
        document.body.appendChild(cursor);
        const move = (e: MouseEvent) => {
            cursor.style.left = `${e.clientX}px`;
            cursor.style.top = `${e.clientY}px`;
        };
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mousedown', (e) => (move(e), cursor.classList.add('down')), true);
        window.addEventListener('mouseup', () => cursor.classList.remove('down'), true);
        const w = window as unknown as Record<string, unknown>;
        w.__tourCaption = (title: string, body: string, step: string) => {
            let el = document.getElementById('__tour-caption');
            if (!el) {
                el = document.createElement('div');
                el.id = '__tour-caption';
                el.setAttribute('aria-hidden', 'true');
                document.body.appendChild(el);
            }
            el.innerHTML = '';
            const b = document.createElement('b');
            b.textContent = title;
            el.appendChild(b);
            if (body) el.appendChild(document.createTextNode(body));
            if (step) {
                const s = document.createElement('small');
                s.textContent = step;
                el.appendChild(s);
            }
            requestAnimationFrame(() => el!.classList.add('on'));
        };
        w.__tourCard = (eyebrow: string, title: string, body: string, on: boolean) => {
            let el = document.getElementById('__tour-card');
            if (!el) {
                el = document.createElement('div');
                el.id = '__tour-card';
                el.setAttribute('aria-hidden', 'true');
                document.body.appendChild(el);
            }
            el.innerHTML = '';
            const e = document.createElement('div');
            e.className = 'eyebrow';
            e.textContent = eyebrow;
            const h = document.createElement('h1');
            h.textContent = title;
            const p = document.createElement('p');
            p.textContent = body;
            el.append(e, h, p);
            requestAnimationFrame(() => el!.classList.toggle('on', on));
        };
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
}

export type Tour = { context: BrowserContext; page: Page; name: string; step: number; total: number };

/** A recorded context at `viewport`, optionally signed in first (the sign-in is not narrated). */
export async function startTour(
    browser: Browser,
    name: string,
    opts: { viewport: { width: number; height: number }; total: number; signInAs?: { email: string; name: string }; cookies?: Cookie[] },
): Promise<Tour> {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    const context = await browser.newContext({ viewport: opts.viewport, recordVideo: { dir: path.join(RAW_DIR, '.tmp'), size: opts.viewport } });
    await context.addInitScript(overlayScript);
    if (opts.signInAs) await signIn(context, opts.signInAs);
    if (opts.cookies) await context.addCookies(opts.cookies);
    const page = await context.newPage();
    return { context, page, name, step: 0, total: opts.total };
}

/** Full-screen title card (shown over whatever page is loaded). */
export async function titleCard(t: Tour, eyebrow: string, title: string, body: string, ms = 3200) {
    if (t.page.url() === 'about:blank') await t.page.goto('/');
    await t.page.evaluate(({ eyebrow, title, body }) => (window as unknown as { __tourCard: (...a: unknown[]) => void }).__tourCard(eyebrow, title, body, true), { eyebrow, title, body });
    await t.page.waitForTimeout(ms);
    await t.page.evaluate(() => (window as unknown as { __tourCard: (...a: unknown[]) => void }).__tourCard('', '', '', false));
    await t.page.waitForTimeout(400);
}

/** Show a numbered caption and give the viewer time to read it. */
export async function say(t: Tour, title: string, body = '', ms = 3000) {
    t.step += 1;
    const step = `Step ${Math.min(t.step, t.total)} of ${t.total}`;
    await t.page.evaluate(({ title, body, step }) => (window as unknown as { __tourCaption: (...a: string[]) => void }).__tourCaption(title, body, step), { title, body, step });
    await t.page.waitForTimeout(ms);
}

/** A caption that does not advance the step counter (asides within a step). */
export async function note(t: Tour, title: string, body = '', ms = 2600) {
    await t.page.evaluate(({ title, body }) => (window as unknown as { __tourCaption: (...a: string[]) => void }).__tourCaption(title, body, ''), { title, body });
    await t.page.waitForTimeout(ms);
}

/** Move the visible cursor onto an element, pause, then click it. */
export async function point(t: Tour, target: Locator, opts: { click?: boolean; pause?: number } = {}) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box) await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await t.page.waitForTimeout(opts.pause ?? 450);
    if (opts.click !== false) await target.click();
}

/** Type like a person, so the video shows the text appearing. */
export async function type(t: Tour, target: Locator, text: string) {
    await point(t, target);
    await target.fill('');
    await target.pressSequentially(text, { delay: 35 });
}

/** Smooth scroll by `dy` pixels (videos read better than jumps). */
export async function scroll(t: Tour, dy: number) {
    await t.page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'smooth' }), dy);
    await t.page.waitForTimeout(900);
}

/** Close the tour and keep its recording as `<name>.webm`. */
export async function endTour(t: Tour, closing?: { title: string; body: string }) {
    if (closing) await titleCard(t, 'That’s it', closing.title, closing.body, 3000);
    const video = t.page.video();
    await t.context.close();
    if (video) await video.saveAs(path.join(RAW_DIR, `${t.name}.webm`));
    await video?.delete();
}

/** Same as `expect(...).toBeVisible()` with a longer default, for slow first compiles. */
export async function shows(target: Locator, timeout = 30_000) {
    await expect(target).toBeVisible({ timeout });
}
