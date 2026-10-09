/**
 * Writes tests/fixtures/cad/object-view-bracket.glb: a tiny binary glTF of the L-bracket the
 * CAD worker would export (legs 80 mm and 50 mm, 40 mm wide, 2 mm thick), in metres and Y-up
 * exactly like CadQuery's GLTF export. CAD bounding box: 80 x 40 x 50 mm.
 *
 *   bun tests/fixtures/cad/generate-object-view-glb.ts
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

type Box = { min: [number, number, number]; max: [number, number, number] };

/** CAD (mm, Z-up) -> glTF (m, Y-up): (x, y, z) -> (x, z, -y) / 1000. */
const toGltf = ([x, y, z]: number[]): [number, number, number] => [x! / 1000, z! / 1000, -y! / 1000];

function boxMesh(boxes: Box[]) {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const { min, max } of boxes) {
        const [x0, y0, z0] = min;
        const [x1, y1, z1] = max;
        // Faces in CAD coordinates: [normal, 4 corners counter-clockwise seen from outside].
        const faces: [number[], number[][]][] = [
            [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
            [[0, 0, -1], [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]],
            [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
            [[-1, 0, 0], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]],
            [[0, 1, 0], [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]],
            [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
        ];
        for (const [n, corners] of faces) {
            const base = positions.length / 3;
            const [nx, ny, nz] = n as [number, number, number];
            for (const c of corners) {
                positions.push(...toGltf(c));
                normals.push(nx, nz, -ny);
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    return { positions, normals, indices };
}

export function buildBracketGlb(): Buffer {
    const { positions, normals, indices } = boxMesh([
        { min: [0, 0, 0], max: [80, 40, 2] },
        { min: [0, 0, 0], max: [2, 40, 50] },
    ]);
    const pos = Buffer.from(new Float32Array(positions).buffer);
    const nrm = Buffer.from(new Float32Array(normals).buffer);
    const idxRaw = Buffer.from(new Uint16Array(indices).buffer);
    const idx = Buffer.concat([idxRaw, Buffer.alloc((4 - (idxRaw.length % 4)) % 4)]);
    const bin = Buffer.concat([pos, nrm, idx]);
    const min = [0, 1, 2].map((i) => Math.min(...positions.filter((_, j) => j % 3 === i)));
    const max = [0, 1, 2].map((i) => Math.max(...positions.filter((_, j) => j % 3 === i)));
    const gltf = {
        asset: { version: '2.0', generator: 'discovermake test fixture' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'bracket' }],
        meshes: [{ name: 'bracket', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
        materials: [{ name: 'steel', pbrMetallicRoughness: { baseColorFactor: [0.72, 0.74, 0.78, 1], metallicFactor: 0.3, roughnessFactor: 0.6 }, doubleSided: true }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
            { buffer: 0, byteOffset: pos.length, byteLength: nrm.length, target: 34962 },
            { buffer: 0, byteOffset: pos.length + nrm.length, byteLength: idxRaw.length, target: 34963 },
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
            { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
            { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
        ],
    };
    let json = Buffer.from(JSON.stringify(gltf), 'utf8');
    json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
    const chunk = (type: string, data: Buffer) => {
        const h = Buffer.alloc(8);
        h.writeUInt32LE(data.length, 0);
        h.write(type, 4, 'ascii');
        return Buffer.concat([h, data]);
    };
    return Buffer.concat([header, chunk('JSON', json), chunk('BIN\0', bin)]);
}

if (process.argv[1]?.endsWith('generate-object-view-glb.ts')) {
    const out = path.join(path.dirname(process.argv[1]), 'object-view-bracket.glb');
    writeFileSync(out, buildBracketGlb());
    console.log(`wrote ${out}`);
}
