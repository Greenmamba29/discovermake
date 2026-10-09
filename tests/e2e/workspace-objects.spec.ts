/**
 * R2 Stage 1 Build Workspace journeys through the real UI and APIs:
 *   - Object View: a build with CAD artifacts (server fixture: the CAD worker does not run in
 *     e2e) shows its dimensions as text, toggles units, offers STEP / DXF / GLB downloads, and
 *     renders the GLB when the browser has WebGL (the fallback otherwise);
 *   - attachment tray: attach an image and a DXF; "Use as a part" reaches an instant quote;
 *   - Ask Make AI with no model key: an honest unavailable state, and a manual requirement
 *     still writes a new design version;
 *   - Product Passport: "Order a replacement" reaches a BINDING quote for the same part.
 */
import { expect, test } from '@playwright/test';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';
import { createBuildWithCad } from './support/cad-build';
import { fulfil, payOrder, quotePart } from './support/journeys';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('Object View shows the CAD model with dimensions, units and downloads', async ({ page, request }) => {
    const { workspaceUrl } = await createBuildWithCad(request);
    await page.goto(`${workspaceUrl}?section=object`);
    await expect(page.getByTestId('section-object')).toHaveAttribute('aria-current', 'page');

    const dims = page.getByTestId('object-dimensions');
    await expect(dims).toBeVisible();
    await expect(page.getByTestId('object-dim-X')).toHaveText('80.0 mm');
    await expect(page.getByTestId('object-dim-Y')).toHaveText('40.0 mm');
    await expect(page.getByTestId('object-dim-Z')).toHaveText('50.0 mm');
    await expect(page.getByTestId('object-summary')).toHaveText('Overall size 80.0 mm wide (X), 40.0 mm deep (Y), 50.0 mm tall (Z).');

    await page.getByTestId('object-unit-in').click();
    await expect(page.getByTestId('object-unit-in')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('object-dim-X')).toHaveText('3.150 in');
    await expect(page.getByTestId('object-dim-Z')).toHaveText('1.969 in');

    // Download panel: STEP, DXF and GLB, each a working signed link.
    for (const kind of ['STEP', 'DXF', 'GLB'] as const) {
        const link = page.getByTestId(`object-download-${kind}`);
        await expect(link).toBeVisible();
        const href = await link.getAttribute('href');
        const res = await request.get(href!);
        expect(res.status(), `${kind} download`).toBe(200);
        if (kind === 'GLB') expect((await res.body()).subarray(0, 4).toString('latin1')).toBe('glTF');
    }

    // WebGL (SwiftShader) when available: the canvas carries the dimension summary as its name.
    // Without WebGL the 2D flat pattern of the same part is shown instead.
    const canvas = page.locator('[data-testid="object-viewport"] canvas');
    const fallback = page.getByTestId('object-fallback');
    await expect(canvas.or(fallback).first()).toBeVisible({ timeout: 20_000 });
    if (await canvas.count()) {
        await expect(canvas).toHaveAttribute('role', 'img');
        await expect(canvas).toHaveAttribute('aria-label', /Overall size 3\.150 in wide/);
        await expect(page.getByText('Loading the 3D model…')).toHaveCount(0, { timeout: 20_000 });
        await page.getByTestId('object-measure').click();
        await expect(page.getByTestId('object-measure')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('object-measure-readout')).toContainText('Click two points');
        await page.getByTestId('object-wireframe').click();
        await expect(page.getByTestId('object-wireframe')).toHaveAttribute('aria-pressed', 'true');
        await page.getByTestId('object-reset').click();
    } else {
        await expect(page.getByRole('img', { name: /Flat pattern/ })).toBeVisible();
    }

    // The Overview card links into the Object View.
    await page.getByTestId('section-overview').click();
    await expect(page.getByTestId('object-card-dims')).toHaveText('80.0 × 40.0 × 50.0 mm');
    await page.getByTestId('object-card-open').click();
    await expect(page.getByTestId('object-view')).toBeVisible();
});

test('attach an image and a DXF; "Use as a part" reaches an instant quote', async ({ page, request }) => {
    const { workspaceUrl } = await createBuildWithCad(request);
    await page.goto(`${workspaceUrl}?section=attachments`);
    await expect(page.getByTestId('attachment-empty')).toBeVisible();

    await page.getByTestId('attachment-input').setInputFiles([
        { name: 'reference-photo.png', mimeType: 'image/png', buffer: PNG },
        { name: 'shelf-bracket.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) },
    ]);
    const list = page.getByTestId('attachment-list');
    await expect(list.getByText('reference-photo.png')).toBeVisible({ timeout: 20_000 });
    await expect(list.getByText('shelf-bracket.dxf')).toBeVisible();
    await expect(list.getByAltText('Preview of reference-photo.png')).toBeVisible();

    // A file whose bytes do not match its extension is refused by the server.
    await page.getByTestId('attachment-input').setInputFiles({ name: 'not-really.png', mimeType: 'image/png', buffer: Buffer.from('GIF89a definitely not a png') });
    await expect(page.getByRole('alert').filter({ hasText: 'not-really.png' })).toContainText('not a PNG image', { timeout: 15_000 });

    await page.getByTestId('attachment-use-as-part').click();
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
    await page.getByTestId('material-option-mat_al_6061').click();
    const thickness = page.getByTestId('thickness-option-thk_al6061_090');
    if (!(await thickness.getAttribute('data-checked'))) await thickness.click();
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
});

test('Ask Make AI without a model key: honest unavailable state, manual requirement still works', async ({ page, request }) => {
    const { buildId, workspaceUrl } = await createBuildWithCad(request);
    await page.goto(`${workspaceUrl}?section=assistant`);
    await expect(page.getByTestId('assistant-unavailable')).toContainText(/not connected to a model/);
    await page.getByTestId('assistant-manual-text').fill('Fits a 120 mm fan');
    await page.getByTestId('assistant-manual-category').selectOption('dimension');
    await page.getByTestId('assistant-manual-submit').click();
    await expect(page.getByTestId('assistant-manual-saved')).toHaveText('Saved as version 3.');
    const graph = await (await request.get(`/api/builds/${buildId}/graph`)).json();
    expect(graph.version.version).toBe(3);
    expect(graph.nodes.some((n: { key: string; source: string }) => n.key === 'req:buyer_1' && n.source === 'user')).toBe(true);
});

test('Passport "Order a replacement" reaches a binding quote for the same part', async ({ page, context }) => {
    test.setTimeout(240_000);
    const quoted = await quotePart(page, 'replacement-plate.dxf');
    const { orderUrl, orderNumber } = await payOrder(page);
    const { passportUrl } = await fulfil(context, orderNumber, orderUrl);

    await page.goto(passportUrl);
    await expect(page.getByTestId('passport-verified')).toBeVisible();
    await page.getByTestId('passport-order-replacement').click();
    await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+\?from=qte_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
    const url = new URL(page.url());
    expect(url.pathname).not.toBe(quoted.partUrl);
    await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 20_000 });
    await expect(page.getByTestId('checkout-cta')).toBeEnabled();
});
