/**
 * Byte fixtures for attachment tests: the smallest real-looking file of each accepted format
 * (correct magic bytes and structure), built in memory.
 */
import { sampleBracketDxf } from '@/lib/sample-dxf';

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: (Uint8Array | number[])[]) => {
    const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
    const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) {
        out.set(a, o);
        o += a.length;
    }
    return out;
};

/** 1x1 transparent PNG. */
export const PNG_1PX = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

export type FixtureKind = 'png' | 'jpg' | 'webp' | 'heic' | 'dxf' | 'dxf-binary' | 'step' | 'stl' | 'stl-binary' | 'svg';

export function attachmentBytes(kind: FixtureKind): Uint8Array {
    switch (kind) {
        case 'png':
            return PNG_1PX;
        case 'jpg':
            return concat([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], enc('JFIF\0'), new Uint8Array(32), [0xff, 0xd9]);
        case 'webp':
            return concat(enc('RIFF'), [0x1a, 0, 0, 0], enc('WEBPVP8 '), new Uint8Array(18));
        case 'heic':
            return concat([0, 0, 0, 0x18], enc('ftypheic'), [0, 0, 0, 0], enc('mif1heic'), new Uint8Array(16));
        case 'dxf':
            return enc(sampleBracketDxf());
        case 'dxf-binary':
            return concat(enc('AutoCAD Binary DXF\r\n'), [0x1a, 0x00], new Uint8Array(64));
        case 'step':
            return enc('ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'bracket\'),\'2;1\');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
        case 'stl':
            return enc('solid part\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid part\n');
        case 'stl-binary': {
            const b = new Uint8Array(84 + 50);
            new DataView(b.buffer).setUint32(80, 1, true);
            return b;
        }
        case 'svg':
            return enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0H100V50H0Z" fill="none" stroke="#000"/></svg>\n');
    }
}
