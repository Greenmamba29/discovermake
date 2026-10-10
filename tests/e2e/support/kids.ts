/**
 * E2E seam and state for Kids & Family. The CAD worker does not run in e2e (CAD_WORKER_URL is
 * unset), so a kid's "See my price" shows the honest "workshop is offline" state. Like
 * Reconstruct's `plantGoldenKnobCad`, `plantGoldenKidCad` then plants exactly what the server
 * stores after a successful workshop build (src/server/kids/designs.ts): the golden STL in the e2e
 * local storage at `kids/designs/<id>/<file>` with its sha256, and the `cad` record on the design.
 * It refuses unless the design is the kid's own name keychain with the expected options. Nothing
 * about the price is faked: "Try again" runs the real print quote engine on the planted geometry.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL, E2E_ENV } from '../../../playwright.config';
import { goldenKeychain } from '../../support/kids-golden';

export const KIDS_PIN = '2468';

function writeObject(key: string, body: Buffer, contentType: string) {
    const file = path.join(process.cwd(), E2E_ENV.STORAGE_LOCAL_DIR!, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    writeFileSync(`${file}.__meta.json`, JSON.stringify({ contentType }));
}

/** Plant the golden workshop output on the grown-up's latest kid design. Returns the design id. */
export async function plantGoldenKidCad(grownUpEmail: string, expected: { label: string; color: string; size?: string } = { label: 'MIA', color: 'blue', size: 'small' }): Promise<string> {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        const [design] = await sql<{ id: string; template: string; params: Record<string, unknown>; status: string }[]>`
            select d.id, d.template, d.params, d.status from kid_designs d join users u on u.id = d.owner_user_id
            where u.email = ${grownUpEmail.toLowerCase()} order by d.created_at desc limit 1`;
        expect(design, 'a kid design exists').toBeDefined();
        expect(design!.template).toBe('name_keychain');
        expect(design!.params).toMatchObject({ label: expected.label, color: expected.color, size: expected.size ?? 'small' });
        expect(design!.status, 'the app showed the offline state first').toBe('offline');
        const g = goldenKeychain();
        const key = `kids/designs/${design!.id}/${g.filename}`;
        writeObject(key, g.stl, 'model/stl');
        const cad = { engine: g.engine, geometry: g.geometry, artifacts: [{ kind: 'stl', filename: g.filename, key, sha256: g.sha256, bytes: g.stl.byteLength }], warnings: [], buildMs: 812 };
        await sql`update kid_designs set cad = ${sql.json(cad as never)}, status = 'new', updated_at = now() where id = ${design!.id}`;
        return design!.id;
    } finally {
        await sql.end();
    }
}

/** Sign a browser context's request client in with an email code (dev returns the code). */
export async function signInApi(request: APIRequestContext, email: string): Promise<void> {
    const headers = { 'x-forwarded-for': `198.20.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` };
    const start = await (await request.post('/api/auth/email/start', { data: { email }, headers })).json();
    const verified = await request.post('/api/auth/email/verify', { data: { challengeId: start.challengeId, code: start.devCode }, headers });
    expect(verified.ok(), 'email sign-in').toBe(true);
}

type FamilyJson = { pinSet: boolean; kids: { id: string; nickname: string }[]; requests: { id: string; status: string }[] };

/**
 * A family with a PIN, kid "Mia" (10–12) and one pending request for a priced name keychain,
 * built through the real APIs (the workshop output planted by the seam). Idempotent per email.
 */
export async function ensureKidsFamily(request: APIRequestContext, email: string): Promise<{ kidId: string }> {
    await signInApi(request, email);
    let family = (await (await request.get('/api/family')).json()) as FamilyJson;
    let mia = family.kids.find((k) => k.nickname === 'Mia');
    if (!mia) {
        const created = await request.post('/api/family/kids', { data: { nickname: 'Mia', ageBand: '10-12', avatar: 'fox' } });
        expect(created.status(), await created.text()).toBe(201);
        mia = await created.json();
    }
    if (!family.pinSet) expect((await request.put('/api/family/pin', { data: { pin: KIDS_PIN } })).ok()).toBe(true);
    if (!family.requests.length) {
        expect((await request.post(`/api/family/kids/${mia!.id}/hand-off`)).ok()).toBe(true);
        const offline = await request.post('/api/kids/designs', { data: { template: 'name_keychain', params: { label: 'MIA', color: 'blue', size: 'small' } } });
        expect(offline.status(), await offline.text()).toBe(201);
        const designId = await plantGoldenKidCad(email);
        const priced = await (await request.post(`/api/kids/designs/${designId}/price`)).json();
        expect(priced.status, JSON.stringify(priced)).toBe('priced');
        expect((await request.post('/api/kids/requests', { data: { designId } })).status()).toBe(201);
        expect((await request.post('/api/kids/exit', { data: { pin: KIDS_PIN } })).ok()).toBe(true);
        family = (await (await request.get('/api/family')).json()) as FamilyJson;
        expect(family.requests.length).toBeGreaterThan(0);
    }
    return { kidId: mia!.id };
}

/** The family above, then "Hand to Mia" in this browser context (Kids mode on). */
export async function enterKidsMode(page: Page, email: string): Promise<void> {
    const { kidId } = await ensureKidsFamily(page.request, email);
    expect((await page.request.post(`/api/family/kids/${kidId}/hand-off`)).ok()).toBe(true);
}
