'use client';

import { Canvas } from '@react-three/fiber';
import { Edges, Line, OrbitControls } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { MaterialCategory, PartPreview } from '@/contracts';

type Pt = readonly [number, number];

function pointInPolygon([x, y]: Pt, poly: readonly Pt[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
    }
    return inside;
}

function bboxArea(poly: readonly Pt[]): number {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return (maxX - minX) * (maxY - minY);
}

/** Outer contours become shapes; each hole goes to the smallest outer that contains it. */
export function buildShapes(preview: PartPreview): THREE.Shape[] {
    const outers = preview.outer.filter((p) => p.length >= 3);
    const shapes = outers.map((poly) => new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y))));
    const areas = outers.map(bboxArea);
    for (const hole of preview.holes) {
        if (hole.length < 3 || shapes.length === 0) continue;
        let best = -1;
        for (let i = 0; i < outers.length; i++) {
            if (pointInPolygon(hole[0], outers[i]) && (best === -1 || areas[i] < areas[best])) best = i;
        }
        shapes[best === -1 ? 0 : best].holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    }
    return shapes;
}

function PartMesh({ preview, thicknessMm, color, category }: { preview: PartPreview; thicknessMm: number; color: string; category: MaterialCategory | null }) {
    const geometry = useMemo(() => {
        const g = new THREE.ExtrudeGeometry(buildShapes(preview), { depth: thicknessMm, bevelEnabled: false, curveSegments: 1 });
        g.translate(-preview.widthMm / 2, -preview.heightMm / 2, -thicknessMm / 2);
        g.computeVertexNormals();
        return g;
    }, [preview, thicknessMm]);

    const metal = category === 'METAL';
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh geometry={geometry} castShadow receiveShadow>
                <meshStandardMaterial color={color} metalness={metal ? 0.55 : 0.05} roughness={metal ? 0.38 : 0.7} />
                <Edges threshold={25} color="#0c0e0d" />
            </mesh>
            {preview.bendLines.map(([a, b], i) => (
                <Line
                    key={i}
                    points={[
                        [a[0] - preview.widthMm / 2, a[1] - preview.heightMm / 2, thicknessMm / 2 + 0.05],
                        [b[0] - preview.widthMm / 2, b[1] - preview.heightMm / 2, thicknessMm / 2 + 0.05],
                    ]}
                    color="#5fe08a"
                    lineWidth={2}
                    dashed
                    dashSize={Math.max(preview.widthMm, preview.heightMm) / 60}
                    gapSize={Math.max(preview.widthMm, preview.heightMm) / 90}
                />
            ))}
        </group>
    );
}

/** Extruded Three.js preview of the part polylines at the selected thickness, with orbit controls. */
export default function PartViewer3D({
    preview,
    thicknessMm,
    color = '#b8bec4',
    category = 'METAL',
}: {
    preview: PartPreview;
    thicknessMm: number;
    color?: string;
    category?: MaterialCategory | null;
}) {
    const d = Math.max(preview.widthMm, preview.heightMm, 10);
    return (
        <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ position: [d * 0.35, d * 0.85, d * 0.95], fov: 38, near: d / 100, far: d * 20 }}
            gl={{ antialias: true, preserveDrawingBuffer: false }}
            aria-hidden
        >
            <color attach="background" args={['#111413']} />
            <ambientLight intensity={0.55} />
            <hemisphereLight args={['#e9f1ec', '#1a1d1c', 0.6]} />
            <directionalLight position={[d, d * 2, d]} intensity={1.6} />
            <directionalLight position={[-d, d, -d]} intensity={0.5} />
            <PartMesh preview={preview} thicknessMm={thicknessMm} color={color} category={category} />
            <gridHelper args={[d * 2.4, 24, '#2a2f2e', '#1d2120']} position={[0, -thicknessMm / 2 - 0.2, 0]} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={d * 0.3} maxDistance={d * 5} />
        </Canvas>
    );
}
