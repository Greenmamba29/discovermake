/**
 * Golden workshop output for Kids & Family tests (vitest and the e2e seam). The CAD worker does
 * not run in tests, so this stands in for its kid-template route: a tiny, valid binary STL of the
 * small name keychain's envelope (a closed 50 x 20 x 4 mm box, 12 triangles) with the geometry the
 * worker would measure. Prices are never faked: the real print engine prices this geometry.
 */
import { createHash } from 'node:crypto';

export const KEYCHAIN_SMALL = { bbox: [50, 20, 4] as [number, number, number] };

/** A closed axis-aligned box as a binary STL (outward normals, CCW winding). */
export function boxStl(x: number, y: number, z: number): Buffer {
    const v = (i: number) => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0];
    // 6 faces x 2 triangles, by corner index (bit0 = x, bit1 = y, bit2 = z).
    const faces: [number[], number[], number, number, number][] = [
        [[0, 0, -1], [0, 2, 3], 0, 3, 1],
        [[0, 0, 1], [4, 5, 7], 4, 7, 6],
        [[0, -1, 0], [0, 1, 5], 0, 5, 4],
        [[0, 1, 0], [2, 6, 7], 2, 7, 3],
        [[-1, 0, 0], [0, 4, 6], 0, 6, 2],
        [[1, 0, 0], [1, 3, 7], 1, 7, 5],
    ];
    const tris: { n: number[]; p: number[][] }[] = [];
    for (const [n, a, b0, b1, b2] of faces) {
        tris.push({ n, p: a.map(v) });
        tris.push({ n, p: [b0, b1, b2].map(v) });
    }
    const buf = Buffer.alloc(84 + tris.length * 50);
    buf.write('DiscoverMake kids golden name_keychain small', 0, 'ascii');
    buf.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => {
        let o = 84 + i * 50;
        for (const c of [t.n, ...t.p]) for (const f of c) (buf.writeFloatLE(f, o), (o += 4));
        buf.writeUInt16LE(0, o);
    });
    return buf;
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export function goldenKeychain() {
    const [x, y, z] = KEYCHAIN_SMALL.bbox;
    const stl = boxStl(x, y, z);
    return {
        stl,
        filename: 'name_keychain.stl',
        sha256: sha256(stl),
        geometry: { bbox_mm: [x, y, z] as [number, number, number], volume_mm3: x * y * z, area_mm2: 2 * (x * y + x * z + y * z), solids: 1, sound: true },
        engine: { name: 'cadgen' as const, version: '0.4.2-golden' },
    };
}

/** The worker's TextToCadBuildResponse (ok) for the golden keychain: STEP, GLB and STL, like the real route. */
export function goldenKidResponse() {
    const g = goldenKeychain();
    // Kids pricing reads only the STL; STEP and GLB are small stand-ins so the client's checks pass.
    const file = (kind: 'step' | 'glb' | 'stl', data: Buffer) => ({ kind, filename: `name_keychain.${kind}`, content_base64: data.toString('base64'), sha256: sha256(data), bytes: data.byteLength });
    return {
        ok: true,
        engine: g.engine,
        artifacts: [file('step', Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;\n')), file('glb', Buffer.from('glTF')), file('stl', g.stl)],
        geometry: g.geometry,
        warnings: [],
        build_ms: 812,
    };
}

/** A fetch stand-in for the worker: records each call; `fail` answers with a contract error. */
export function goldenKidWorker(opts: { fail?: { code: string; message: string } } = {}) {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push({ url, body: JSON.parse(String(init?.body ?? 'null')), auth: new Headers(init?.headers).get('authorization') });
        const body = opts.fail ? { ok: false, code: opts.fail.code, message: opts.fail.message, violations: [] } : goldenKidResponse();
        // Like the worker: build outcomes, including contract errors, answer 200.
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch & { calls: typeof calls };
    impl.calls = calls;
    return impl;
}
