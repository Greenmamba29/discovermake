'use client';

/**
 * The Object View's WebGL viewport (react-three-fiber). Loaded lazily with `next/dynamic`
 * (ssr: false) only when the Object section is open and WebGL is available, so three.js never
 * weighs on the workspace's first paint.
 *
 * World units are millimetres: the GLB (metres, Y-up) is scaled with `inferScaleToMm`, centred
 * on X/Z and set on the floor. Measuring picks points on the mesh in those world units, so a
 * distance needs no further conversion. All controls live outside the canvas as real buttons.
 */
import { Canvas, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { distance3, fitCameraDistance, formatLength, gltfSizeToCad, inferScaleToMm, type LengthUnit, type Vec3 } from './geometry';

export type ObjectViewport3DProps = {
    url: string;
    /** CAD bounding box from the worker's metrics (mm), used to pick the GLB's unit scale. */
    expectedBboxMm: Vec3 | null;
    unit: LengthUnit;
    showBox: boolean;
    wireframe: boolean;
    measuring: boolean;
    points: Vec3[];
    resetSignal: number;
    /** Accessible name of the canvas (the dimension summary). */
    label: string;
    onPick: (p: Vec3) => void;
    /** Measured CAD-axis size (mm) once the mesh is loaded. */
    onLoaded: (sizeMm: Vec3) => void;
};

type Fitted = { object: THREE.Object3D; size: THREE.Vector3 };

function useFittedModel(url: string, expectedBboxMm: Vec3 | null, wireframe: boolean): Fitted {
    const gltf = useLoader(GLTFLoader, url);
    const invalidate = useThree((s) => s.invalidate);
    const fitted = useMemo(() => {
        const root = gltf.scene.clone(true);
        root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const cloned = mats.map((m) => {
                const c = m.clone() as THREE.MeshStandardMaterial;
                if ('metalness' in c) {
                    c.metalness = Math.min(c.metalness ?? 0, 0.4);
                    c.roughness = Math.max(c.roughness ?? 0.5, 0.45);
                }
                c.side = THREE.DoubleSide;
                return c;
            });
            mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
        });
        const raw = new THREE.Box3().setFromObject(root);
        const rawSize = raw.getSize(new THREE.Vector3());
        const expectedMax = expectedBboxMm ? Math.max(...expectedBboxMm) : null;
        const scale = inferScaleToMm(Math.max(rawSize.x, rawSize.y, rawSize.z), expectedMax);
        const center = raw.getCenter(new THREE.Vector3());
        const holder = new THREE.Group();
        root.position.set(-center.x, -raw.min.y, -center.z);
        holder.add(root);
        holder.scale.setScalar(scale);
        holder.updateMatrixWorld(true);
        return { object: holder, size: rawSize.clone().multiplyScalar(scale) };
    }, [gltf, expectedBboxMm]);

    useEffect(() => {
        fitted.object.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                (m as THREE.MeshStandardMaterial).wireframe = wireframe;
            }
        });
        invalidate();
    }, [fitted, wireframe, invalidate]);
    return fitted;
}

function CameraRig({ size, resetSignal }: { size: THREE.Vector3; resetSignal: number }) {
    const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
    const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
    const viewport = useThree((s) => s.size);
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        const dist = fitCameraDistance([size.x, size.y, size.z], camera.fov, viewport.width / Math.max(viewport.height, 1));
        const dir = new THREE.Vector3(1, 0.75, 1.25).normalize();
        const target = new THREE.Vector3(0, size.y / 2, 0);
        camera.position.copy(target.clone().add(dir.multiplyScalar(dist)));
        camera.near = Math.max(dist / 200, 0.01);
        camera.far = dist * 50;
        camera.updateProjectionMatrix();
        if (controls) {
            controls.target.copy(target);
            controls.update();
        } else {
            camera.lookAt(target);
        }
        invalidate();
        // Re-fit on reset and when the model or the controls change; not on every resize.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size, resetSignal, controls, camera]);
    return null;
}

/**
 * A text label drawn on a canvas texture and shown as a sprite (always faces the camera, drawn
 * on top). Pure three.js: no extra DOM roots inside the canvas. Labels are decorative; the same
 * numbers are in the dimensions list and the canvas's accessible name.
 */
function TextLabel({ text, position, height }: { text: string; position: THREE.Vector3Tuple; height: number }) {
    const label = useMemo(() => {
        const fontPx = 44;
        const padX = 16;
        const padY = 10;
        const font = `600 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.font = font;
        const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
        const h = fontPx + padY * 2;
        c.width = w;
        c.height = h;
        ctx.fillStyle = 'rgba(12, 14, 13, 0.88)';
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(0, 0, w, h, 12);
            ctx.fill();
        } else {
            ctx.fillRect(0, 0, w, h);
        }
        ctx.font = font;
        ctx.fillStyle = '#eceeeb';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, padX, h / 2 + 2);
        const texture = new THREE.CanvasTexture(c);
        texture.colorSpace = THREE.SRGBColorSpace;
        return { texture, aspect: w / h };
    }, [text]);
    useEffect(() => () => label?.texture.dispose(), [label]);
    if (!label) return null;
    return (
        <sprite position={position} scale={[height * label.aspect, height, 1]} renderOrder={10}>
            <spriteMaterial map={label.texture} depthTest={false} transparent />
        </sprite>
    );
}

function BoundingBox({ size, unit }: { size: THREE.Vector3; unit: LengthUnit }) {
    const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), [size]);
    useEffect(() => () => edges.dispose(), [edges]);
    const cad = gltfSizeToCad([size.x, size.y, size.z]);
    const h = Math.max(size.x, size.y, size.z) / 16;
    return (
        <group>
            <lineSegments geometry={edges} position={[0, size.y / 2, 0]}>
                <lineBasicMaterial color="#5fe08a" transparent opacity={0.75} />
            </lineSegments>
            <TextLabel text={`X ${formatLength(cad[0], unit)}`} position={[0, -h * 0.8, size.z / 2 + h * 0.6]} height={h} />
            <TextLabel text={`Y ${formatLength(cad[1], unit)}`} position={[size.x / 2 + h * 2.2, -h * 0.8, 0]} height={h} />
            <TextLabel text={`Z ${formatLength(cad[2], unit)}`} position={[size.x / 2 + h * 2.2, size.y / 2, size.z / 2]} height={h} />
        </group>
    );
}

function Measurement({ points, unit, radius }: { points: Vec3[]; unit: LengthUnit; radius: number }) {
    const [a, b] = points;
    return (
        <group>
            {points.map((p, i) => (
                <mesh key={i} position={p as unknown as THREE.Vector3Tuple} renderOrder={11}>
                    <sphereGeometry args={[radius, 16, 16]} />
                    <meshBasicMaterial color="#ffb347" depthTest={false} />
                </mesh>
            ))}
            {a && b && (
                <>
                    <Line points={[a as unknown as THREE.Vector3Tuple, b as unknown as THREE.Vector3Tuple]} color="#ffb347" lineWidth={2} depthTest={false} />
                    <TextLabel text={formatLength(distance3(a, b), unit)} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + radius * 4, (a[2] + b[2]) / 2]} height={radius * 5} />
                </>
            )}
        </group>
    );
}

function Model(props: ObjectViewport3DProps) {
    const { object, size } = useFittedModel(props.url, props.expectedBboxMm, props.wireframe);
    const { onLoaded } = props;
    useEffect(() => {
        onLoaded(gltfSizeToCad([size.x, size.y, size.z]));
    }, [size, onLoaded]);
    const onClick = (e: ThreeEvent<MouseEvent>) => {
        if (!props.measuring) return;
        e.stopPropagation();
        props.onPick([e.point.x, e.point.y, e.point.z]);
    };
    const max = Math.max(size.x, size.y, size.z);
    return (
        <>
            <primitive object={object} onClick={onClick} />
            {props.showBox && <BoundingBox size={size} unit={props.unit} />}
            <Measurement points={props.points} unit={props.unit} radius={max / 110} />
            <gridHelper args={[max * 3, 30, '#2a2f2e', '#1d2120']} />
            <CameraRig size={size} resetSignal={props.resetSignal} />
        </>
    );
}

export default function ObjectViewport3D(props: ObjectViewport3DProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', props.label);
    }, [props.label]);
    return (
        <Canvas
            ref={canvasRef}
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ position: [200, 160, 260], fov: 35, near: 0.1, far: 10000 }}
            gl={{ antialias: true, preserveDrawingBuffer: false }}
            style={{ cursor: props.measuring ? 'crosshair' : 'grab' }}
            data-testid="object-canvas"
        >
            <color attach="background" args={['#111413']} />
            {/* Neutral studio lighting: soft key, fill and rim, no HDR download. */}
            <ambientLight intensity={0.45} />
            <hemisphereLight args={['#f2f5f3', '#2a2d2c', 0.55]} />
            <directionalLight position={[1, 2, 1.5]} intensity={1.5} />
            <directionalLight position={[-1.5, 1, -1]} intensity={0.45} />
            <directionalLight position={[0, -1, 1.5]} intensity={0.2} />
            <Suspense fallback={null}>
                <Model {...props} />
            </Suspense>
            <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        </Canvas>
    );
}
