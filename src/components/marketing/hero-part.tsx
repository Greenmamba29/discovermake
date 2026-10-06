/**
 * Object-first hero: the sample mounting plate's real flat pattern (120 x 80 mm,
 * 4 x Ø6.5, Ø30 cutout) with dimension callouts, drawn as an SVG blueprint.
 */
export function HeroPart() {
    return (
        <figure className="relative">
            <svg viewBox="-24 -22 176 132" className="h-auto w-full" role="img" aria-labelledby="hero-part-title">
                <title id="hero-part-title">Flat pattern of a 120 by 80 millimetre mounting plate with four 6.5 millimetre holes and a 30 millimetre centre cutout</title>
                <defs>
                    <pattern id="hero-grid" width="8" height="8" patternUnits="userSpaceOnUse">
                        <path d="M8 0H0V8" fill="none" stroke="#151716" strokeOpacity="0.06" strokeWidth="0.3" />
                    </pattern>
                </defs>
                <rect x="-24" y="-22" width="176" height="132" fill="url(#hero-grid)" />
                <g transform="translate(0 0)">
                    <path
                        d="M0 0H120V80H0Z M15.25 12a3.25 3.25 0 1 0 -6.5 0a3.25 3.25 0 1 0 6.5 0Z M111.25 12a3.25 3.25 0 1 0 -6.5 0a3.25 3.25 0 1 0 6.5 0Z M111.25 68a3.25 3.25 0 1 0 -6.5 0a3.25 3.25 0 1 0 6.5 0Z M15.25 68a3.25 3.25 0 1 0 -6.5 0a3.25 3.25 0 1 0 6.5 0Z M75 40a15 15 0 1 0 -30 0a15 15 0 1 0 30 0Z"
                        fill="#1a1d1c"
                        fillRule="evenodd"
                    />
                    <path d="M0 0H120V80H0Z" fill="none" stroke="#5fe08a" strokeWidth="0.6" strokeDasharray="2 1.5" />
                </g>
                <g fill="none" stroke="#53585a" strokeWidth="0.35">
                    <path d="M0 -8V-14M120 -8V-14M0 -11H120" />
                    <path d="M128 0H134M128 80H134M131 0V80" />
                    <path d="M75 40L96 26H112" />
                </g>
                <g fontFamily="var(--font-jetbrains), monospace" fontSize="4.6" fill="#151716">
                    <text x="60" y="-13" textAnchor="middle">120.0 mm</text>
                    <text x="137" y="42" transform="rotate(90 137 42)" textAnchor="middle">80.0 mm</text>
                    <text x="98" y="24.5">Ø30.0</text>
                    <text x="0" y="95">4× Ø6.5 · 6061 aluminum · 0.090&quot;</text>
                </g>
            </svg>
            <figcaption className="sr-only">Sample part used by the “Try a sample” button.</figcaption>
        </figure>
    );
}
