import { patternBounds, shapeSvgPath, type FlatPattern } from '@/lib/dxf-builder';

/** Flat-pattern drawing of a bundled starter design (the object first), bend lines dashed in signal green. */
export function PatternArt({ pattern, title }: { pattern: FlatPattern; title: string }) {
    const b = patternBounds(pattern);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const pad = Math.max(w, h) * 0.08;
    const stroke = Math.max(w, h) / 300;
    // Draw in y-up coordinates: flip the whole drawing once.
    const d = pattern.cuts.map(shapeSvgPath).join('');
    return (
        <svg viewBox={`${b.minX - pad} ${-b.maxY - pad} ${w + pad * 2} ${h + pad * 2}`} className="h-full w-full" role="img" aria-label={`Flat pattern of the ${title}, ${Math.round(w)} by ${Math.round(h)} millimetres`}>
            <g transform="scale(1 -1)">
                <path d={d} fill="#a9afab" fillRule="evenodd" stroke="#eceeeb" strokeWidth={stroke} />
                {(pattern.bends ?? []).map((bend, i) => (
                    <line key={i} x1={bend.a[0]} y1={bend.a[1]} x2={bend.b[0]} y2={bend.b[1]} stroke="#5fe08a" strokeWidth={stroke * 2.2} strokeDasharray={`${stroke * 8} ${stroke * 5}`} />
                ))}
            </g>
        </svg>
    );
}
