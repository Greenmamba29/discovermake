/**
 * Discover starter catalog (workflow 10: Pinterest / Behance grid; seeded by onboarding "Pick 5").
 *
 * Every card starts a REAL flow, nothing is a placeholder:
 * - `quote` cards upload a bundled, valid DXF (dxf-builder conventions: CUT / BEND layers,
 *   $INSUNITS = mm) through the normal upload -> analyze pipeline, price it with the preset
 *   below and open the configurator prefilled with that instant quote;
 * - `make-ai` cards open Make AI with a precise prompt, for processes the partner network
 *   sources (CNC, 3D printing, wood, reconstruction).
 * `tests/discover/catalog-dxf.test.ts` runs every bundled DXF through the real analyzer and
 * quote engine and requires a binding, orderable quote for its preset.
 */
import type { InterestSlug } from '@/contracts/account';
import type { CreateQuoteRequest } from '@/contracts/quotes';
import { buildDxf, type FlatPattern, type Shape } from './dxf-builder';
import { sampleBracketDxf } from './sample-dxf';

export type QuotePresetConfig = Omit<CreateQuoteRequest, 'partId'>;

export type DiscoverStart =
    | { kind: 'quote'; filename: string; dxf: () => string; preview: FlatPattern; preset: QuotePresetConfig }
    | { kind: 'make-ai'; prompt: string };

export type DiscoverItem = {
    slug: string;
    title: string;
    summary: string;
    /** Process family shown on the card. */
    process: 'Laser cut' | 'Laser cut + bend' | 'CNC' | '3D print' | 'Wood' | 'Reconstruct';
    /** Size and material line (technical data, shown in mono). */
    specs: string;
    interests: readonly InterestSlug[];
    start: DiscoverStart;
};

const BEND = { serviceId: 'svc_bending' } as const;
const circle = (x: number, y: number, r: number): Shape => ({ kind: 'circle', c: [x, y], r });

/** Starter that uploads a bundled flat pattern. */
function laser(filename: string, pattern: FlatPattern, preset: Pick<QuotePresetConfig, 'materialId' | 'thicknessOptionId'> & Partial<QuotePresetConfig>, dxf: () => string = () => buildDxf(pattern)): DiscoverStart {
    return { kind: 'quote', filename, dxf, preview: pattern, preset: { finishServiceId: null, services: [], ...preset, quantity: preset.quantity ?? 1 } };
}

// ---- flat patterns (mm) ----------------------------------------------------

/** Same geometry as the bundled sample (`sampleBracketDxf`), for the card preview. */
const WALL_BRACKET: FlatPattern = {
    cuts: [{ kind: 'rect', x: 0, y: 0, w: 120, h: 80 }, circle(12, 12, 3.25), circle(108, 12, 3.25), circle(108, 68, 3.25), circle(12, 68, 3.25), circle(60, 40, 15)],
};

/** 60 mm wide L bracket: 80 mm wall leg, 80 mm shelf leg, two Ø5 holes per leg. */
const SHELF_BRACKET: FlatPattern = {
    cuts: [{ kind: 'rect', x: 0, y: 0, w: 60, h: 160, r: 4 }, circle(15, 40, 2.5), circle(45, 40, 2.5), circle(15, 120, 2.5), circle(45, 120, 2.5)],
    bends: [{ a: [0, 80], b: [60, 80] }],
};

/** 300 x 150 mm sign blank with radiused corners and four Ø5 stand-off holes. */
const SIGN_PANEL: FlatPattern = {
    cuts: [{ kind: 'rect', x: 0, y: 0, w: 300, h: 150, r: 12 }, circle(15, 15, 2.5), circle(285, 15, 2.5), circle(285, 135, 2.5), circle(15, 135, 2.5)],
};

/** U-shaped under-desk tray: 400 mm long, 80 mm deep, 40 mm walls, three screw slots. */
const CABLE_TRAY: FlatPattern = {
    cuts: [
        { kind: 'rect', x: 0, y: 0, w: 400, h: 160 },
        { kind: 'slot', c: [60, 80], length: 10, width: 5.5 },
        { kind: 'slot', c: [200, 80], length: 10, width: 5.5 },
        { kind: 'slot', c: [340, 80], length: 10, width: 5.5 },
    ],
    bends: [
        { a: [0, 40], b: [400, 40] },
        { a: [0, 120], b: [400, 120] },
    ],
};

/** U-cover for a 120 x 80 x 30 mm electronics enclosure: vent slots on top, M3 clearance holes in the side flanges. */
const ENCLOSURE_COVER: FlatPattern = {
    cuts: [
        { kind: 'rect', x: 0, y: 0, w: 120, h: 140 },
        ...[55, 62.5, 70, 77.5, 85].map((y): Shape => ({ kind: 'slot', c: [60, y], length: 50, width: 4 })),
        circle(20, 12, 1.7),
        circle(100, 12, 1.7),
        circle(20, 128, 1.7),
        circle(100, 128, 1.7),
    ],
    bends: [
        { a: [0, 30], b: [120, 30] },
        { a: [0, 110], b: [120, 110] },
    ],
};

/** 100 x 75 mm Raspberry Pi 4/5 plate: the 58 x 49 mm M2.5 pattern plus four Ø4.5 corner holes. */
const PI_PLATE: FlatPattern = {
    cuts: [
        { kind: 'rect', x: 0, y: 0, w: 100, h: 75, r: 4 },
        circle(21, 13, 1.35),
        circle(79, 13, 1.35),
        circle(79, 62, 1.35),
        circle(21, 62, 1.35),
        circle(7, 7, 2.25),
        circle(93, 7, 2.25),
        circle(93, 68, 2.25),
        circle(7, 68, 2.25),
    ],
};

/** Ø130 mm speaker grille: hex-pattern Ø4 perforations inside Ø90, four Ø4 mounting holes. */
const SPEAKER_GRILLE: FlatPattern = (() => {
    const c = 65;
    const holes: Shape[] = [];
    const pitch = 7;
    const row = pitch * Math.sin(Math.PI / 3);
    for (let j = -7; j <= 7; j++) {
        for (let i = -7; i <= 7; i++) {
            const x = i * pitch + (j % 2 ? pitch / 2 : 0);
            const y = j * row;
            if (Math.hypot(x, y) <= 43) holes.push(circle(c + x, c + y, 2));
        }
    }
    const m = 57 / Math.SQRT2;
    return { cuts: [circle(c, c, 65), ...holes, circle(c + m, c + m, 2), circle(c - m, c + m, 2), circle(c - m, c - m, 2), circle(c + m, c - m, 2)] };
})();

/** 160 x 120 mm robot deck: battery window, motor-bracket and standoff holes. */
const ROBOT_CHASSIS: FlatPattern = {
    cuts: [
        { kind: 'rect', x: 0, y: 0, w: 160, h: 120, r: 10 },
        { kind: 'rect', x: 50, y: 40, w: 60, h: 40, r: 5 },
        ...[
            [10, 10],
            [150, 10],
            [150, 110],
            [10, 110],
            [30, 25],
            [30, 95],
            [130, 25],
            [130, 95],
        ].map(([x, y]) => circle(x, y, 1.7)),
    ],
};

/** 26 x 30 mm hexagon pendant with a Ø12 window and a Ø3 bail hole. */
const HEX_PENDANT: FlatPattern = (() => {
    const R = 15;
    const pts = Array.from({ length: 6 }, (_, k) => {
        const a = Math.PI / 2 + (k * Math.PI) / 3;
        return [Math.round((15 + R * Math.cos(a)) * 1000) / 1000, Math.round((15 + R * Math.sin(a)) * 1000) / 1000] as const;
    });
    return { cuts: [{ kind: 'poly', pts }, circle(15, 15, 6), circle(15, 24.5, 1.5)] };
})();

/** Plant marker stake: 60 x 40 mm label on a 12 mm pointed stake, 150 mm tall. */
const PLANT_MARKER: FlatPattern = {
    cuts: [
        {
            kind: 'poly',
            pts: [
                [30, 0],
                [36, 12],
                [36, 110],
                [60, 110],
                [60, 150],
                [0, 150],
                [0, 110],
                [24, 110],
                [24, 12],
            ],
        },
    ],
};

/** Three-panel folding stove windscreen, 300 x 110 mm, with vent holes along the bottom. */
const WINDSCREEN: FlatPattern = {
    cuts: [{ kind: 'rect', x: 0, y: 0, w: 300, h: 110, r: 3 }, ...[25, 50, 75, 125, 150, 175, 225, 250, 275].map((x) => circle(x, 20, 4))],
    bends: [
        { a: [100, 0], b: [100, 110] },
        { a: [200, 0], b: [200, 110] },
    ],
};

/** 220 x 35 mm battery hold-down bar with slotted ends for J-bolts. */
const BATTERY_HOLD_DOWN: FlatPattern = {
    cuts: [
        { kind: 'rect', x: 0, y: 0, w: 220, h: 35, r: 4 },
        { kind: 'slot', c: [20, 17.5], length: 12, width: 8.5 },
        { kind: 'slot', c: [200, 17.5], length: 12, width: 8.5 },
    ],
};

// ---- catalog -----------------------------------------------------------------

export const DISCOVER_CATALOG: readonly DiscoverItem[] = [
    {
        slug: 'wall-bracket',
        title: 'Wall bracket',
        summary: 'A flat mounting bracket with four screw holes and a 30 mm cable pass-through. Our sample part, quoted in seconds.',
        process: 'Laser cut',
        specs: '120 × 80 mm · Aluminum 6061 · 0.090"',
        interests: ['brackets-mounts', 'home-repair', 'desk-setup'],
        start: laser('wall-bracket.dxf', WALL_BRACKET, { materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090' }, sampleBracketDxf),
    },
    {
        slug: 'electronics-enclosure',
        title: 'Electronics enclosure cover',
        summary: 'A bent U-cover for a 120 × 80 × 30 mm project box, with vent slots and M3 screw holes in the flanges.',
        process: 'Laser cut + bend',
        specs: '120 × 140 mm flat · Aluminum 5052 · 0.063" · 2 bends',
        interests: ['enclosures', 'robotics', 'audio'],
        start: laser('enclosure-cover.dxf', ENCLOSURE_COVER, { materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_063', services: [BEND] }),
    },
    {
        slug: 'sign-panel',
        title: 'Sign panel',
        summary: 'A gloss black acrylic sign blank with radiused corners and four stand-off holes. Add your lettering as cut-outs.',
        process: 'Laser cut',
        specs: '300 × 150 mm · Black cast acrylic · 3 mm',
        interests: ['signage', 'home-repair', 'garden'],
        start: laser('sign-panel.dxf', SIGN_PANEL, { materialId: 'mat_acrylic_black', thicknessOptionId: 'thk_acr_blk_3' }),
    },
    {
        slug: 'desk-cable-tray',
        title: 'Desk cable tray',
        summary: 'An under-desk U tray that swallows power strips and cable spaghetti. Three slots for wood screws.',
        process: 'Laser cut + bend',
        specs: '400 × 80 × 40 mm · Mild steel · 16 ga · 2 bends',
        interests: ['desk-setup', 'furniture'],
        start: laser('desk-cable-tray.dxf', CABLE_TRAY, { materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_16ga', services: [BEND] }),
    },
    {
        slug: 'bike-phone-mount',
        title: 'Bike phone mount',
        summary: 'A handlebar phone cradle for a 31.8 mm bar. Make AI plans it; a 3D-printing partner makes it.',
        process: '3D print',
        specs: 'PETG · fits phones up to 80 mm wide',
        interests: ['bikes', 'camping'],
        start: {
            kind: 'make-ai',
            prompt: 'A 3D-printed bike handlebar phone mount for a 31.8 mm handlebar, in PETG. It holds a phone up to 80 mm wide with a slot for a silicone band, and the clamp tightens with one M4 bolt. 1 piece.',
        },
    },
    {
        slug: 'shelf-bracket',
        title: 'L shelf bracket',
        summary: 'A 90° bracket for floating shelves: 80 mm legs, two screw holes in each. Powder coat it in the configurator.',
        process: 'Laser cut + bend',
        specs: '60 × 80 × 80 mm · Mild steel · 14 ga · 1 bend',
        interests: ['brackets-mounts', 'furniture', 'home-repair'],
        start: laser('l-shelf-bracket.dxf', SHELF_BRACKET, { materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_14ga', services: [BEND] }),
    },
    {
        slug: 'raspberry-pi-plate',
        title: 'Raspberry Pi mounting plate',
        summary: 'The 58 × 49 mm M2.5 hole pattern for a Pi 4 or Pi 5, plus four corner holes to mount it anywhere.',
        process: 'Laser cut',
        specs: '100 × 75 mm · Aluminum 6061 · 0.090"',
        interests: ['robotics', 'enclosures', 'drones'],
        start: laser('raspberry-pi-plate.dxf', PI_PLATE, { materialId: 'mat_al_6061', thicknessOptionId: 'thk_al6061_090' }),
    },
    {
        slug: 'drone-frame',
        title: '5-inch FPV drone frame',
        summary: 'A true-X carbon frame with a 30.5 mm stack mount. Make AI plans it; a CNC partner cuts it.',
        process: 'CNC',
        specs: '225 mm motor to motor · 4 mm carbon fiber',
        interests: ['drones', 'robotics'],
        start: {
            kind: 'make-ai',
            prompt: 'A 5-inch FPV drone frame, CNC-cut from 4 mm carbon fiber: true-X layout, 225 mm motor to motor, 30.5 × 30.5 mm flight stack mount, four replaceable arms plus a top and a bottom plate. 1 set.',
        },
    },
    {
        slug: 'speaker-grille',
        title: 'Speaker grille',
        summary: 'A perforated round grille for a 4-inch driver, with four mounting holes on a 114 mm circle.',
        process: 'Laser cut',
        specs: 'Ø130 mm · Mild steel · 18 ga',
        interests: ['audio', 'home-repair'],
        start: laser('speaker-grille.dxf', SPEAKER_GRILLE, { materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_18ga' }),
    },
    {
        slug: 'pendant-lamp',
        title: 'Plywood pendant lamp',
        summary: 'A slotted-rib lamp shade that assembles without glue around an E26 socket. Make AI plans the parts.',
        process: 'Wood',
        specs: 'Ø300 mm · Baltic birch plywood · 3 mm',
        interests: ['lighting', 'furniture'],
        start: {
            kind: 'make-ai',
            prompt: 'A laser-cut Baltic birch plywood pendant lamp shade, 300 mm in diameter and 3 mm thick, built from slotted ribs that assemble without glue around an E26 socket and cord set. 1 lamp.',
        },
    },
    {
        slug: 'robot-chassis',
        title: 'Robot chassis deck',
        summary: 'A two-motor robot deck with a battery window, motor-bracket holes and M3 standoff holes.',
        process: 'Laser cut',
        specs: '160 × 120 mm · Aluminum 5052 · 0.125"',
        interests: ['robotics', 'drones'],
        start: laser('robot-chassis.dxf', ROBOT_CHASSIS, { materialId: 'mat_al_5052', thicknessOptionId: 'thk_al5052_125' }),
    },
    {
        slug: 'hex-pendant',
        title: 'Hex pendant',
        summary: 'A brass hexagon pendant with a round window and a bail hole. Polish it or leave the laser edge.',
        process: 'Laser cut',
        specs: '26 × 30 mm · Brass 260 · 0.040"',
        interests: ['jewelry', 'cosplay-props'],
        start: laser('hex-pendant.dxf', HEX_PENDANT, { materialId: 'mat_brass_260', thicknessOptionId: 'thk_brass_040' }),
    },
    {
        slug: 'cosplay-armor',
        title: 'Cosplay chest armor',
        summary: 'Chest plates split to fit a 250 mm print bed, with strap slots. Make AI plans the split; a print partner makes it.',
        process: '3D print',
        specs: 'PLA · sized for a 100 cm chest',
        interests: ['cosplay-props'],
        start: {
            kind: 'make-ai',
            prompt: 'Cosplay chest armor, 3D-printed in PLA and sized for a 100 cm chest. Split it into parts that fit a 250 × 250 mm print bed, with 25 mm strap slots and alignment pins between parts. 1 set.',
        },
    },
    {
        slug: 'plant-markers',
        title: 'Plant marker stakes',
        summary: 'Stainless garden stakes with a 60 × 40 mm label face. They will not rust in the soil.',
        process: 'Laser cut',
        specs: '60 × 150 mm · Stainless 304 · 18 ga',
        interests: ['garden'],
        start: laser('plant-marker.dxf', PLANT_MARKER, { materialId: 'mat_ss_304', thicknessOptionId: 'thk_ss304_18ga', quantity: 10 }),
    },
    {
        slug: 'stove-windscreen',
        title: 'Folding stove windscreen',
        summary: 'A three-panel stainless windscreen for camp stoves, with vent holes along the base.',
        process: 'Laser cut + bend',
        specs: '300 × 110 mm · Stainless 304 · 22 ga · 2 bends',
        interests: ['camping'],
        start: laser('stove-windscreen.dxf', WINDSCREEN, { materialId: 'mat_ss_304', thicknessOptionId: 'thk_ss304_22ga', services: [BEND] }),
    },
    {
        slug: 'battery-hold-down',
        title: 'Battery hold-down bar',
        summary: 'A steel hold-down bar with slotted ends for the J-bolts in most car battery trays.',
        process: 'Laser cut',
        specs: '220 × 35 mm · Mild steel · 11 ga',
        interests: ['automotive'],
        start: laser('battery-hold-down.dxf', BATTERY_HOLD_DOWN, { materialId: 'mat_steel_crs', thicknessOptionId: 'thk_crs_11ga' }),
    },
    {
        slug: 'headphone-hanger',
        title: 'Under-desk headphone hanger',
        summary: 'A clamp-on aluminum headphone hook for desks up to 40 mm thick. Make AI plans it; a CNC partner machines it.',
        process: 'CNC',
        specs: 'Aluminum 6061 · black anodized',
        interests: ['desk-setup', 'audio'],
        start: {
            kind: 'make-ai',
            prompt: 'A CNC-machined 6061 aluminum headphone hanger that clamps under a desk up to 40 mm thick, black anodized, with a felt-lined hook 40 mm wide. 1 piece.',
        },
    },
    {
        slug: 'stove-knob',
        title: 'Replace a broken knob',
        summary: 'Describe the broken part and Make AI plans a replacement. Photo reconstruction comes later.',
        process: 'Reconstruct',
        specs: 'Heat-resistant nylon · 6 mm D-shaft',
        interests: ['home-repair'],
        start: {
            kind: 'make-ai',
            prompt: 'Replace a broken part: the plastic knob on my stove snapped off its 6 mm D-shaft. It is about 38 mm across and 22 mm tall, with a pointer line on top. Make 2 in heat-resistant nylon.',
        },
    },
];

/**
 * Interest filter: with nothing selected every card shows; otherwise a card shows when it
 * shares at least one interest with the selection. Order is preserved.
 */
export function filterCatalog(items: readonly DiscoverItem[], selected: readonly InterestSlug[]): DiscoverItem[] {
    if (selected.length === 0) return [...items];
    const want = new Set(selected);
    return items.filter((i) => i.interests.some((s) => want.has(s)));
}
